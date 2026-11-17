import { describe, expect, it } from "vitest";
import { world, type World } from "./world";

const APPEND_ONLY = [
  "settings_versions", "icp_versions", "icp_signoffs", "sprinto_facts_versions", "runs", "step_events", "pages", "facts", "scores",
  "contacts", "manual_contacts", "hunter_cache", "suppressions", "decisions", "usage_ledger", "worker_ticks", "emails", "role_changes", "golden_runs",
];

describe("history cannot be rewritten", () => {
  it("has the guards on every append-only table", async () => {
    const w = await world();
    const rows = await w.db.admin<{ table_name: string; upd: boolean; del: boolean; trunc: boolean }>(
      `select c.relname table_name, bool_or((t.tgtype & 16) <> 0) upd, bool_or((t.tgtype & 8) <> 0) del, bool_or((t.tgtype & 32) <> 0) trunc
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal and (t.tgtype & 2) <> 0 group by c.relname`,
    );
    const byTable = new Map(rows.map((r) => [r.table_name, r]));
    for (const t of APPEND_ONLY) {
      const r = byTable.get(t);
      expect(r?.upd, `${t} update`).toBe(true);
      expect(r?.del, `${t} delete`).toBe(true);
      expect(r?.trunc, `${t} truncate`).toBe(true);
    }
  });

  async function seeded(): Promise<World> {
    const w = await world();
    const run = await w.startRun(["acme.com"]);
    await w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'x.com', 'asked us to stop')");
    await w.s.operator.query("insert into public.decisions (run_id, kind, reason) values ($1, 'skip', 'not relevant')", [run]);
    await w.s.worker.query("select public.record_tick('cron', 1)");
    return w;
  }

  it.each([
    ["settings_versions", "update public.settings_versions set daily_send_cap = 999"],
    ["icp_versions", "update public.icp_versions set config = '{}'"],
    ["icp_signoffs", "update public.icp_signoffs set note = 'x'"],
    ["sprinto_facts_versions", "update public.sprinto_facts_versions set content = '{}'"],
    ["runs", "update public.runs set note = 'x'"],
    ["step_events", "update public.step_events set status = 'ok'"],
    ["suppressions", "update public.suppressions set action = 'lift'"],
    ["decisions", "update public.decisions set reason = 'changed my mind'"],
    ["worker_ticks", "update public.worker_ticks set processed = 99"],
    ["settings_versions", "delete from public.settings_versions"],
    ["runs", "delete from public.runs"],
    ["step_events", "delete from public.step_events"],
    ["decisions", "delete from public.decisions"],
    ["suppressions", "truncate public.suppressions"],
    ["step_events", "truncate public.step_events"],
    ["runs", "truncate public.runs cascade"],
  ])("refuses %s: %s", async (_t, sql) => {
    const w = await seeded();
    await expect(w.db.admin(sql)).rejects.toThrow(/append-only/);
  });

  it("refuses the same changes from the service role (which also has no privileges) and from signed-in admins", async () => {
    const w = await seeded();
    await expect(w.db.service().query("update public.step_events set status = 'ok'")).rejects.toThrow(/permission denied/);
    await expect(w.s.admin.query("update public.step_events set status = 'ok'")).rejects.toThrow(/permission denied/);
    await expect(w.s.admin.query("delete from public.decisions")).rejects.toThrow(/permission denied/);
  });

  it("makes lifting a suppression a new row, and the newest row decides", async () => {
    const w = await seeded();
    expect((await w.s.viewer.query<{ s: boolean }>("select public.is_suppressed('domain', 'x.com') s"))[0]!.s).toBe(true);
    await w.s.operator.query("insert into public.suppressions (kind, value, action, reason) values ('domain', 'x.com', 'lift', 'asked us to resume')");
    expect((await w.s.viewer.query<{ s: boolean }>("select public.is_suppressed('domain', 'x.com') s"))[0]!.s).toBe(false);
    await w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'x.com', 'asked again')");
    expect((await w.s.viewer.query<{ s: boolean }>("select public.is_suppressed('domain', 'x.com') s"))[0]!.s).toBe(true);
    expect((await w.db.admin<{ n: number }>("select count(*)::int n from public.suppressions where value = 'x.com'"))[0]!.n).toBe(3);
  });

  it("requires a reason on every decision and a well-formed suppression", async () => {
    const w = await seeded();
    const [run] = await w.db.admin<{ id: string }>("select id from public.runs");
    await expect(w.s.operator.query("insert into public.decisions (run_id, kind, reason) values ($1, 'skip', ' ')", [run!.id])).rejects.toThrow(/violates check constraint/);
    await expect(w.s.operator.query("insert into public.decisions (kind, reason) values ('skip', 'fine reason')")).rejects.toThrow(/violates check constraint/);
    await expect(w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'UPPER.com', 'because')")).rejects.toThrow(/violates check constraint/);
    await expect(w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'has space.com', 'because')")).rejects.toThrow(/violates check constraint/);
    await expect(w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('person', 'a@b.com', 'because')")).rejects.toThrow(/violates check constraint/);
  });
});

describe("retention (the 90-day rule)", () => {
  async function withContact(w: World, domain = "acme.com") {
    await w.startRun([domain]);
    const p = await w.claim();
    await w.s.worker.query("insert into public.contacts (prospect_id, source, first_name, last_name, position, email, confidence, rank_score, rank_parts, chosen) values ($1, 'hunter', 'Priya', 'Rao', 'CTO', 'priya@acme.com', 94, 88, '[{\"label\": \"title\"}]', true)", [p!.id]);
    await w.s.worker.query("insert into public.hunter_cache (domain, response) values ($1, '{\"emails\": [{\"value\": \"priya@acme.com\"}]}')", [domain]);
    await w.s.operator.query("insert into public.manual_contacts (domain, first_name, email) values ($1, 'Sam', 'sam@acme.com')", [domain]);
    return p!;
  }
  const backdate = async (w: World, days: number) => {
    for (const t of ["contacts", "hunter_cache", "manual_contacts"]) {
      await w.db.admin(`alter table public.${t} disable trigger user`);
      await w.db.admin(`update public.${t} set created_at = now() - interval '${days} days'`);
      await w.db.admin(`alter table public.${t} enable trigger user`);
    }
  };

  it("blanks names and addresses after 90 days and keeps the rest of the trail", async () => {
    const w = await world();
    await withContact(w);
    await backdate(w, 91);
    expect(await w.s.worker.query("select public.run_retention(90)")).toEqual([{ run_retention: { contacts: 1, manual_contacts: 1, hunter_cache: 1 } }]);
    const [c] = await w.db.admin<Record<string, unknown>>("select * from public.contacts");
    expect(c).toMatchObject({ first_name: null, last_name: null, email: null, position: "CTO", confidence: 94, rank_score: 88, chosen: true });
    expect(c!.scrubbed_at).not.toBeNull();
    expect((await w.db.admin<{ response: unknown }>("select response from public.hunter_cache"))[0]!.response).toBeNull();
    expect((await w.db.admin<{ email: unknown }>("select email from public.manual_contacts"))[0]!.email).toBeNull();
  });

  it("leaves recent rows alone, and is safe to run again", async () => {
    const w = await world();
    await withContact(w);
    await backdate(w, 30);
    expect(await w.s.worker.query("select public.run_retention(90)")).toEqual([{ run_retention: { contacts: 0, manual_contacts: 0, hunter_cache: 0 } }]);
    await backdate(w, 100);
    await w.s.worker.query("select public.run_retention(90)");
    expect(await w.s.worker.query("select public.run_retention(90)")).toEqual([{ run_retention: { contacts: 0, manual_contacts: 0, hunter_cache: 0 } }]);
  });

  it("is the only way to change a contact: no edits, no un-scrubbing, no deleting", async () => {
    const w = await world();
    await withContact(w);
    await expect(w.db.admin("update public.contacts set position = 'CEO'")).rejects.toThrow(/only personal data may be scrubbed|only a first scrub|NULL/);
    await expect(w.db.admin("update public.contacts set email = 'x@y.co', scrubbed_at = now()")).rejects.toThrow(/may only be set to NULL/);
    await expect(w.db.admin("update public.contacts set email = null, first_name = null, last_name = null, scrubbed_at = now(), position = 'CEO'")).rejects.toThrow(/only personal data may be scrubbed/);
    await expect(w.db.admin("delete from public.contacts")).rejects.toThrow(/append-only/);
    await w.db.admin("update public.contacts set email = null, first_name = null, last_name = null, scrubbed_at = now()");
    await expect(w.db.admin("update public.contacts set email = 'back@again.co'")).rejects.toThrow(/only a first scrub|may only be set to NULL/);
    await expect(w.db.admin("update public.contacts set scrubbed_at = null")).rejects.toThrow(/only a first scrub/);
  });

  it("is not callable by a viewer", async () => {
    const w = await world();
    await expect(w.s.viewer.query("select public.run_retention(90)")).rejects.toThrow(/Not allowed/);
  });
});

describe("the worker's heartbeat", () => {
  it("records ticks, and the status view says when the last one was and never an all-clear it did not check", async () => {
    const w = await world();
    expect((await w.s.viewer.query<{ last_tick: string | null }>("select last_tick from public.worker_status"))[0]!.last_tick).toBeNull();
    await w.s.worker.query("select public.record_tick('cron', 3)");
    const [s] = await w.s.viewer.query<{ last_tick: string }>("select last_tick from public.worker_status");
    expect(new Date(s!.last_tick).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await w.s.pending.query("select * from public.worker_status")).toEqual([]);
    await expect(w.s.viewer.query("select public.record_tick('cron', 1)")).rejects.toThrow(/Not allowed/);
  });
});

describe("'newest row wins' does not depend on the clock", () => {
  it("lets a lift undo an add even when both rows carry the same timestamp", async () => {
    const w = await world();
    // Rows written in one transaction share now(). The sequence number, not the time, decides which is newer.
    // Twelve pairs, so a tie broken by random ids could not pass by luck (one in 4,096).
    const domains = Array.from({ length: 12 }, (_, i) => `tie${i}.com`);
    await w.db.exec(domains.map((d) => `insert into public.suppressions (kind, value, reason) values ('domain', '${d}', 'asked to stop'); insert into public.suppressions (kind, value, action, reason) values ('domain', '${d}', 'lift', 'they came back');`).join("\n"));
    const stamps = await w.db.admin<{ n: number }>("select count(distinct created_at)::int n from public.suppressions");
    expect(stamps[0]!.n).toBe(1);
    for (const d of domains) expect((await w.s.viewer.query<{ s: boolean }>("select public.is_suppressed('domain', $1) s", [d]))[0]!.s, d).toBe(false);
  });

  it("lets a resume undo a pause with the same timestamp", async () => {
    const w = await world();
    const run = await w.startRun(["a.com"]);
    await w.db.exec(`insert into public.decisions (run_id, kind, reason) values ('${run}', 'pause_run', 'checking'); insert into public.decisions (run_id, kind, reason) values ('${run}', 'resume_run', 'all good')`);
    for (let i = 0; i < 10; i += 1) expect((await w.s.viewer.query<{ p: boolean }>("select public.run_is_paused($1) p", [run]))[0]!.p).toBe(false);
  });
});
