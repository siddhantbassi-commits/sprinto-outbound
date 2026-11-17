import { describe, expect, it } from "vitest";
import { world } from "./world";

describe("create_run", () => {
  it("makes one prospect per domain, normalised and de-duplicated, and records the versions it ran under", async () => {
    const w = await world();
    const run = await w.startRun(["Acme.com", " acme.com ", "beta.io", "", "gamma.co.uk"]);
    const ps = await w.prospects(run);
    expect(ps.map((p) => p.domain)).toEqual(["acme.com", "beta.io", "gamma.co.uk"]);
    expect(ps.every((p) => p.step === "queued" && p.lane === "active")).toBe(true);
    const [r] = await w.db.admin<{ domain_count: number; icp_version_id: string; settings_version_id: string; facts_version_id: string; created_by: string }>("select * from public.runs where id = $1", [run]);
    expect(r).toMatchObject({ domain_count: 3, created_by: w.u.operator });
    const [{ n }] = await w.db.admin<{ n: number }>("select count(*)::int n from public.step_events where run_id = $1 and step = 'create'", [run]) as [{ n: number }];
    expect(n).toBe(3);
  });

  it("refuses to run on an ICP nobody has signed off", async () => {
    const w = await world({ signoff: false });
    await expect(w.startRun(["acme.com"])).rejects.toThrow(/No ICP version has been signed off/);
  });

  it("uses the newest signed-off ICP, not a newer unsigned one", async () => {
    const w = await world();
    const [first] = await w.db.admin<{ id: string }>("select id from public.icp_versions order by version desc limit 1");
    await w.s.admin.query("insert into public.icp_versions (config, reason) values ('{\"draft\": true}', 'draft v2, unsigned')");
    const run = await w.startRun(["acme.com"]);
    const [r] = await w.db.admin<{ icp_version_id: string }>("select icp_version_id from public.runs where id = $1", [run]);
    expect(r!.icp_version_id).toBe(first!.id);
  });

  it.each([
    ["nothing", [] as string[], /at least one domain/],
    ["only blanks", ["", "  "], /at least one domain/],
    ["an IP address", ["10.0.0.1"], /Not valid domains: 10.0.0.1/],
    ["localhost", ["localhost"], /Not valid domains/],
    ["a reserved suffix", ["intranet.corp"], /Not valid domains/],
    ["a scheme", ["https://acme.com"], /Not valid domains/],
    ["a path", ["acme.com/x"], /Not valid domains/],
    ["a space", ["ac me.com"], /Not valid domains/],
    ["a trailing dash", ["acme-.com"], /Not valid domains/],
    ["an injection attempt", ["acme.com'; drop table runs;--"], /Not valid domains/],
  ])("refuses %s", async (_n, domains, message) => {
    const w = await world();
    await expect(w.startRun(domains)).rejects.toThrow(message);
  });

  it("refuses a run bigger than the cap", async () => {
    const w = await world();
    await w.settings({ max_run_size: 2 });
    await expect(w.startRun(["a.com", "b.com", "c.com"])).rejects.toThrow(/at most 2 domains \(this one has 3\)/);
    await expect(w.startRun(["a.com", "b.com"])).resolves.toBeTruthy();
  });

  it("parks a suppressed domain as skipped, with the reason, and does not queue it", async () => {
    const w = await world();
    await w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'optout.com', 'asked us to stop')");
    const run = await w.startRun(["optout.com", "fine.com"]);
    const ps = await w.prospects(run);
    expect(ps.find((p) => p.domain === "optout.com")).toMatchObject({ lane: "skipped", lane_reason: "Suppressed: do not contact" });
    expect(ps.find((p) => p.domain === "fine.com")!.lane).toBe("active");
    const claimed = await w.claim();
    expect(claimed!.domain).toBe("fine.com");
    expect(await w.claim()).toBeUndefined();
  });

  it("lets a lifted suppression run again", async () => {
    const w = await world();
    await w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'optout.com', 'asked us to stop')");
    await w.s.operator.query("insert into public.suppressions (kind, value, action, reason) values ('domain', 'optout.com', 'lift', 'they asked to hear from us')");
    const run = await w.startRun(["optout.com"]);
    expect((await w.prospects(run))[0]!.lane).toBe("active");
  });

  it("only lets an operator or admin start a run", async () => {
    const w = await world();
    await expect(w.s.worker.query("select public.create_run('{a.com}', 'paste', '', '{}'::jsonb)")).rejects.toThrow(/Only an operator/);
  });

  it("allows a domain only once per run", async () => {
    const w = await world();
    const run = await w.startRun(["a.com"]);
    await expect(w.db.admin("insert into public.prospects (run_id, domain) values ($1, 'a.com')", [run])).rejects.toThrow(/duplicate key/);
  });
});

describe("claim_next_prospect", () => {
  it("leases the next due prospect to the caller and returns nothing when there is none", async () => {
    const w = await world();
    expect(await w.claim()).toBeUndefined();
    await w.startRun(["a.com", "b.com"]);
    const a = await w.claim();
    expect(a).toMatchObject({ leased_by: w.u.worker });
    expect(new Date(a!.lease_until!).getTime()).toBeGreaterThan(Date.now());
  });

  it("never hands out a prospect that is already leased, and gives each worker a different one", async () => {
    const w = await world();
    await w.startRun(["a.com", "b.com", "c.com"]);
    const a = await w.claim("worker");
    const b = await w.claim("worker2");
    const c = await w.claim("worker");
    expect(new Set([a!.id, b!.id, c!.id]).size).toBe(3);
    expect(await w.claim("worker2")).toBeUndefined();
  });

  it("hands a prospect out again once its lease has run out (a crashed worker)", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const first = await w.claim("worker");
    expect(await w.claim("worker2")).toBeUndefined();
    await w.db.admin("update public.prospects set lease_until = now() - interval '1 second' where id = $1", [first!.id]);
    const again = await w.claim("worker2");
    expect(again).toMatchObject({ id: first!.id, leased_by: w.u.worker2 });
  });

  it("serves the earliest due prospect first, and none that are not yet due", async () => {
    const w = await world();
    const run = await w.startRun(["later.com", "sooner.com", "never.com"]);
    await w.db.admin("update public.prospects set next_run_at = now() - interval '2 hours' where domain = 'sooner.com' and run_id = $1", [run]);
    await w.db.admin("update public.prospects set next_run_at = now() - interval '1 hour' where domain = 'later.com' and run_id = $1", [run]);
    await w.db.admin("update public.prospects set next_run_at = now() + interval '1 hour' where domain = 'never.com' and run_id = $1", [run]);
    expect((await w.claim("worker"))!.domain).toBe("sooner.com");
    expect((await w.claim("worker2"))!.domain).toBe("later.com");
    expect(await w.claim("worker")).toBeUndefined();
  });

  it("keeps no more than max_parallel in flight", async () => {
    const w = await world();
    await w.settings({ max_parallel: 2 });
    await w.startRun(["a.com", "b.com", "c.com"]);
    expect(await w.claim("worker")).toBeDefined();
    expect(await w.claim("worker2")).toBeDefined();
    expect(await w.claim("worker")).toBeUndefined();
  });

  it("skips a paused run and picks it up again on resume", async () => {
    const w = await world();
    const run = await w.startRun(["a.com"]);
    await w.s.operator.query("insert into public.decisions (run_id, kind, reason) values ($1, 'pause_run', 'checking the output')", [run]);
    expect(await w.claim()).toBeUndefined();
    await w.s.operator.query("insert into public.decisions (run_id, kind, reason) values ($1, 'resume_run', 'all good')", [run]);
    expect(await w.claim()).toBeDefined();
  });

  it("clamps an absurd lease length", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim("worker", 999_999);
    expect(new Date(p!.lease_until!).getTime() - Date.now()).toBeLessThanOrEqual(601_000);
  });

  it("is refused for anyone who is not a worker, operator or admin", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    await expect(w.s.viewer.query("select * from public.claim_next_prospect()")).rejects.toThrow(/Not allowed/);
  });
});

describe("advance, park and fail", () => {
  it("walks a prospect through every step, writing one trace row per step named for what was done", async () => {
    const w = await world();
    const run = await w.startRun(["a.com"]);
    for (const from of ["queued", "scraped", "qualified", "contact_found", "pains_chosen"]) {
      const p = await w.claim();
      expect(p!.step).toBe(from);
      await w.s.worker.query("select * from public.advance_prospect($1, $2, '{\"note\": 1}'::jsonb, 'm', 'v1', 100, 5)", [p!.id, from]);
    }
    const [p] = await w.prospects(run);
    expect(p).toMatchObject({ step: "drafted", lane: "active", leased_by: null, attempts: 0 });
    const events = await w.db.admin<{ step: string; status: string; model: string | null; tokens: number | null; created_by: string | null }>("select step, status, model, tokens, created_by from public.step_events where run_id = $1 order by id", [run]);
    expect(events.map((e) => e.step)).toEqual(["create", "scrape", "qualify", "contact", "pains", "draft"]);
    expect(events.slice(1).every((e) => e.status === "ok" && e.model === "m" && e.tokens === 100 && e.created_by === w.u.worker)).toBe(true);
  });

  it("refuses a worker that does not hold the lease", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim("worker");
    await expect(w.s.worker2.query("select * from public.advance_prospect($1, 'queued')", [p!.id])).rejects.toThrow(/lease_lost/);
  });

  it("refuses once the lease has expired, even for the same worker", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim("worker");
    await w.db.admin("update public.prospects set lease_until = now() - interval '1 second' where id = $1", [p!.id]);
    await expect(w.s.worker.query("select * from public.advance_prospect($1, 'queued')", [p!.id])).rejects.toThrow(/lease_lost/);
  });

  it("refuses a step that is not the one the prospect is on, so a replayed call cannot skip ahead", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    await expect(w.s.worker.query("select * from public.advance_prospect($1, 'scraped')", [p!.id])).rejects.toThrow(/step_mismatch/);
  });

  it("does not let advance_prospect take a drafted prospect to sent; only the email functions can", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    await w.toDrafted("a.com");
    const p = (await w.prospects())[0]!;
    await expect(w.s.worker.query("select * from public.advance_prospect($1, 'drafted')", [p.id])).rejects.toThrow(/cannot be advanced this way/);
  });

  it("parks a prospect in a lane with a reason, and a parked prospect is never claimed again", async () => {
    const w = await world();
    const run = await w.startRun(["a.com"]);
    const p = await w.claim();
    const [parked] = await w.s.worker.query<{ lane: string; lane_reason: string; step: string }>("select * from public.park_prospect($1, 'queued', 'not_fit', 'A consumer app, not B2B software')", [p!.id]);
    expect(parked).toMatchObject({ lane: "not_fit", lane_reason: "A consumer app, not B2B software", step: "queued" });
    expect(await w.claim()).toBeUndefined();
    const [e] = await w.db.admin<{ status: string; output: { lane: string } }>("select status, output from public.step_events where run_id = $1 and step = 'scrape'", [run]);
    expect(e).toMatchObject({ status: "parked", output: { lane: "not_fit" } });
  });

  it("only parks in a real lane, and only with a reason", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    await expect(w.s.worker.query("select * from public.park_prospect($1, 'queued', 'sent', 'sneaky')", [p!.id])).rejects.toThrow(/Cannot park in lane/);
    await expect(w.s.worker.query("select * from public.park_prospect($1, 'queued', 'active', 'sneaky')", [p!.id])).rejects.toThrow(/Cannot park in lane/);
    await expect(w.s.worker.query("select * from public.park_prospect($1, 'queued', 'held', ' ')", [p!.id])).rejects.toThrow(/reason is required/);
  });

  it("retries a failure after a wait that doubles, and gives up on the third", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const waits: number[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const p = await w.claim();
      expect(p, `attempt ${i}`).toBeDefined();
      const [r] = await w.s.worker.query<{ lane: string; attempts: number; next_run_at: string; last_error: string }>("select * from public.fail_prospect($1, 'queued', 'Gemini overloaded')", [p!.id]);
      expect(r!.attempts).toBe(i);
      if (i < 3) {
        waits.push(Math.round((new Date(r!.next_run_at).getTime() - Date.now()) / 1000));
        expect(await w.claim()).toBeUndefined(); // still waiting
        await w.db.admin("update public.prospects set next_run_at = now() where id = $1", [p!.id]);
      } else {
        expect(r).toMatchObject({ lane: "failed", last_error: "Gemini overloaded" });
      }
    }
    expect(waits[0]).toBeGreaterThanOrEqual(28);
    expect(waits[0]).toBeLessThanOrEqual(30);
    expect(waits[1]).toBeGreaterThanOrEqual(58);
    expect(waits[1]).toBeLessThanOrEqual(60);
  });

  it("fails at once, with the error, when it is not worth retrying", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    const [r] = await w.s.worker.query<{ lane: string; lane_reason: string }>("select * from public.fail_prospect($1, 'queued', 'The API key was refused', false)", [p!.id]);
    expect(r).toMatchObject({ lane: "failed", lane_reason: "The API key was refused" });
  });

  it("resets the attempt count after a step succeeds", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    await w.s.worker.query("select * from public.fail_prospect($1, 'queued', 'blip')", [p!.id]);
    await w.db.admin("update public.prospects set next_run_at = now()");
    const again = await w.claim();
    await w.s.worker.query("select * from public.advance_prospect($1, 'queued')", [again!.id]);
    expect((await w.prospects())[0]!.attempts).toBe(0);
  });

  it("caps a long error message", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    await w.s.worker.query("select * from public.fail_prospect($1, 'queued', $2, false)", [p!.id, "x".repeat(2000)]);
    expect((await w.prospects())[0]!.last_error!.length).toBe(500);
  });

  it("extends and releases a lease only for its holder", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim("worker");
    await expect(w.s.worker2.query("select public.extend_lease($1, 300)", [p!.id])).rejects.toThrow(/lease_lost/);
    await expect(w.s.worker.query("select public.extend_lease($1, 300)", [p!.id])).resolves.toBeTruthy();
    await w.s.worker2.query("select public.release_prospect($1)", [p!.id]);
    expect((await w.prospects())[0]!.leased_by).toBe(w.u.worker);
    await w.s.worker.query("select public.release_prospect($1)", [p!.id]);
    expect((await w.prospects())[0]!.leased_by).toBeNull();
    expect(await w.claim("worker2")).toBeDefined();
  });

  it("cannot be moved by a direct update, even by an operator or the worker", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    for (const who of ["operator", "worker", "admin"] as const) {
      await expect(w.s[who].query("update public.prospects set lane = 'sent', step = 'sent'")).rejects.toThrow(/permission denied/);
      await expect(w.s[who].query("insert into public.step_events (prospect_id, run_id, step, status) select id, run_id, 'send', 'ok' from public.prospects")).rejects.toThrow(/permission denied/);
    }
  });
});

describe("results can only be written by the worker holding the lease", () => {
  it("accepts pages, facts and scores from the lease holder, and refuses anyone else", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim("worker");
    const page = "insert into public.pages (prospect_id, url, kind, status, bytes, sha256, text, fetched_at) values ($1, 'https://a.com/', 'home', 200, 10, repeat('a', 64), 'hello', now())";
    await expect(w.s.worker2.query(page, [p!.id])).rejects.toThrow(/row-level security/);
    await expect(w.s.operator.query(page, [p!.id])).rejects.toThrow(/row-level security/);
    await expect(w.s.worker.query(page, [p!.id])).resolves.toBeDefined();
    await expect(w.s.worker.query("insert into public.facts (prospect_id, pass, facts) values ($1, 1, '{}')", [p!.id])).resolves.toBeDefined();
  });

  it("refuses results once the lease has expired", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    await w.db.admin("update public.prospects set lease_until = now() - interval '1 second' where id = $1", [p!.id]);
    await expect(w.s.worker.query("insert into public.facts (prospect_id, pass, facts) values ($1, 1, '{}')", [p!.id])).rejects.toThrow(/row-level security/);
  });

  it("copies a score onto the prospect, except for a replay", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    const [icp] = await w.db.admin<{ id: string }>("select id from public.icp_versions limit 1");
    await w.s.worker.query("insert into public.scores (prospect_id, icp_version_id, score, verdict) values ($1, $2, 72, 'qualified')", [p!.id, icp!.id]);
    expect((await w.prospects())[0]).toMatchObject({ score: 72, verdict: "qualified" });
    await w.s.worker.query("insert into public.scores (prospect_id, icp_version_id, score, verdict, replay) values ($1, $2, 12, 'not_fit', true)", [p!.id, icp!.id]);
    expect((await w.prospects())[0]).toMatchObject({ score: 72, verdict: "qualified" });
    await expect(w.s.worker.query("insert into public.scores (prospect_id, icp_version_id, score, verdict) values ($1, $2, 101, 'qualified')", [p!.id, icp!.id])).rejects.toThrow(/violates check constraint/);
  });

  it("allows only one chosen contact per prospect", async () => {
    const w = await world();
    await w.startRun(["a.com"]);
    const p = await w.claim();
    const ins = "insert into public.contacts (prospect_id, source, email, chosen) values ($1, 'hunter', $2, true)";
    await w.s.worker.query(ins, [p!.id, "a@a.com"]);
    await expect(w.s.worker.query(ins, [p!.id, "b@a.com"])).rejects.toThrow(/duplicate key/);
  });
});

describe("resume_prospect (a person puts a parked prospect back)", () => {
  async function parked(w: Awaited<ReturnType<typeof world>>, lane = "review") {
    await w.startRun(["a.com"]);
    const p = await w.claim();
    await w.s.worker.query("select * from public.park_prospect($1, 'queued', $2, 'Maybe: a person decides')", [p!.id, lane]);
    return p!;
  }

  it("puts it back in the queue, records the decision with the reason, and clears the old error", async () => {
    const w = await world();
    const p = await parked(w);
    const [r] = await w.s.operator.query<{ lane: string; step: string; attempts: number }>("select * from public.resume_prospect($1, 'Looks right to me')", [p.id]);
    expect(r).toMatchObject({ lane: "active", step: "queued", attempts: 0 });
    const [d] = await w.db.admin<{ kind: string; reason: string; created_by: string }>("select kind, reason, created_by from public.decisions where prospect_id = $1", [p.id]);
    expect(d).toMatchObject({ kind: "promote", reason: "Looks right to me", created_by: w.u.operator });
    expect(await w.claim()).toMatchObject({ id: p.id });
  });

  it.each(["review", "held", "needs_more", "failed", "no_contact"])("can resume a prospect in the %s lane", async (lane) => {
    const w = await world();
    const p = await parked(w, lane === "failed" ? "held" : lane);
    if (lane === "failed") await w.db.admin("update public.prospects set lane = 'failed' where id = $1", [p.id]);
    await expect(w.s.admin.query("select * from public.resume_prospect($1, 'second look', 'rerun')", [p.id])).resolves.toBeTruthy();
  });

  it.each(["not_fit", "skipped"])("refuses a %s prospect", async (lane) => {
    const w = await world();
    const p = await parked(w, lane);
    await expect(w.s.operator.query("select * from public.resume_prospect($1, 'second look')", [p.id])).rejects.toThrow(/cannot be resumed/);
  });

  it("refuses sent and unknown prospects, and active ones, which must not be touched", async () => {
    const w = await world();
    await w.startRun(["a.com", "b.com"]);
    const [a, b] = await w.prospects();
    for (const lane of ["sent", "unknown", "active"]) {
      await w.db.admin("update public.prospects set lane = $2 where id = $1", [a!.id, lane]);
      await expect(w.s.operator.query("select * from public.resume_prospect($1, 'second look')", [a!.id]), lane).rejects.toThrow(/cannot be resumed/);
    }
    expect(b).toBeDefined();
  });

  it("needs a person, a reason and a valid kind, and will not resume a suppressed domain", async () => {
    const w = await world();
    const p = await parked(w);
    await expect(w.s.worker.query("select * from public.resume_prospect($1, 'second look')", [p.id])).rejects.toThrow(/Only an operator/);
    await expect(w.s.viewer.query("select * from public.resume_prospect($1, 'second look')", [p.id])).rejects.toThrow(/Only an operator/);
    await expect(w.s.operator.query("select * from public.resume_prospect($1, ' ')", [p.id])).rejects.toThrow(/reason is required/);
    await expect(w.s.operator.query("select * from public.resume_prospect($1, 'second look', 'pause_run')", [p.id])).rejects.toThrow(/Unknown decision kind/);
    await w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'a.com', 'asked us to stop')");
    await expect(w.s.operator.query("select * from public.resume_prospect($1, 'second look')", [p.id])).rejects.toThrow(/suppressed/);
  });
});
