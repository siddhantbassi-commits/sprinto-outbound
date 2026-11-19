import { describe, expect, it } from "vitest";
import { TEST_TO, world, type World } from "./world";

interface Email {
  id: string;
  status: string;
  send_attempts: number;
  domain: string;
  gmail_message_id: string | null;
  send_error: string | null;
}
const email = async (w: World, id: string) => (await w.db.admin<Email>("select * from public.emails where id = $1", [id]))[0]!;
const reserve = async (w: World, id: string, who: "worker" | "worker2" = "worker") => (await w.s[who].query<{ reserve_send: { ok: boolean; reason?: string; test_to?: string } }>("select public.reserve_send($1)", [id]))[0]!.reserve_send;
const prospectOf = async (w: World, domain: string) => (await w.db.admin<{ step: string; lane: string; lane_reason: string | null; next_run_at: string; leased_by: string | null }>("select * from public.prospects where domain = $1 order by created_at desc limit 1", [domain]))[0]!;

describe("a draft is written once", () => {
  it("must start as drafted or held, takes its domain from the prospect, and needs the lease", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const p = await w.claim();
    const ins = (status: string) => w.s.worker.query("insert into public.emails (prospect_id, domain, subject, body, status) values ($1, 'forged.com', 's', 'b', $2) returning domain", [p!.id, status]);
    await expect(ins("sent")).rejects.toThrow(/must start as drafted or held/);
    await expect(ins("sending")).rejects.toThrow(/must start as drafted or held/);
    expect((await ins("drafted"))[0]).toMatchObject({ domain: "acme.com" });
    await expect(w.s.worker2.query("insert into public.emails (prospect_id, domain, subject, body, attempt) values ($1, 'x.com', 's', 'b', 2)", [p!.id])).rejects.toThrow(/row-level security/);
  });

  it("cannot be edited, deleted or have its status forced, even by the database owner", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const { emailId } = await w.toDrafted("acme.com");
    await expect(w.db.admin("update public.emails set body = 'changed' where id = $1", [emailId])).rejects.toThrow(/cannot be edited/);
    await expect(w.db.admin("update public.emails set subject = 'changed' where id = $1", [emailId])).rejects.toThrow(/cannot be edited/);
    await expect(w.db.admin("update public.emails set status = 'sent' where id = $1", [emailId])).rejects.toThrow(/Illegal email status change drafted to sent/);
    await expect(w.db.admin("delete from public.emails")).rejects.toThrow(/append-only/);
    // email_reviews and email_deliveries reference emails, so a plain truncate is refused by the foreign key. Truncating them all
    // together gets past that check, and the append-only guard must still stop it.
    await expect(w.db.admin("truncate public.emails")).rejects.toThrow(/foreign key|append-only/);
    await expect(w.db.admin("truncate public.emails, public.email_reviews, public.email_deliveries")).rejects.toThrow(/append-only/);
    await expect(w.s.worker.query("update public.emails set status = 'sending'")).rejects.toThrow(/permission denied/);
  });

  it("starts fresh whatever the caller claims about its send state", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const p = await w.claim();
    const [e] = await w.s.worker.query<Email>("insert into public.emails (prospect_id, domain, subject, body, send_attempts, gmail_message_id, sending_at) values ($1, 'x', 's', 'b', 2, 'fake-id', now()) returning *", [p!.id]);
    expect(e).toMatchObject({ send_attempts: 0, gmail_message_id: null });
  });
});

describe("reserve_send", () => {
  it("reserves the send and returns the recorded test address", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const { emailId } = await w.toDrafted("acme.com");
    expect(await reserve(w, emailId)).toEqual({ ok: true, test_to: TEST_TO, deliver_to: null, send_attempts: 1 });
    expect(await email(w, emailId)).toMatchObject({ status: "sending", send_attempts: 1 });
  });

  it("refuses when test mode has no address", async () => {
    const w = await world({ configure: false });
    await w.startRun(["acme.com"]);
    const { emailId } = await w.toDrafted("acme.com");
    expect(await reserve(w, emailId)).toEqual({ ok: false, reason: "test_mode_unset" });
    expect((await email(w, emailId)).status).toBe("drafted");
  });

  it("refuses a second reserve of the same email", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const { emailId } = await w.toDrafted("acme.com");
    await reserve(w, emailId);
    expect(await reserve(w, emailId)).toEqual({ ok: false, reason: "not_sendable" });
  });

  it("refuses without the lease", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const { emailId } = await w.toDrafted("acme.com", "worker");
    await expect(w.s.worker2.query("select public.reserve_send($1)", [emailId])).rejects.toThrow(/lease_lost/);
  });

  it("refuses a suppressed domain, and a suppressed contact address", async () => {
    const w = await world();
    await w.startRun(["acme.com", "beta.com"]);
    const a = await w.toDrafted("acme.com");
    await w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('domain', 'acme.com', 'asked us to stop')");
    expect(await reserve(w, a.emailId)).toEqual({ ok: false, reason: "suppressed" });
    await w.s.worker.query("select public.release_prospect($1)", [a.prospect.id]);

    const b = await w.toDrafted("beta.com");
    await w.db.admin("alter table public.contacts disable trigger user");
    await w.db.admin("insert into public.contacts (prospect_id, source, email, chosen) values ($1, 'hunter', 'Priya@Beta.com', true)", [b.prospect.id]);
    await w.db.admin("alter table public.contacts enable trigger user");
    await w.s.operator.query("insert into public.suppressions (kind, value, reason) values ('address', 'priya@beta.com', 'unsubscribed')");
    expect(await reserve(w, b.emailId)).toEqual({ ok: false, reason: "suppressed" });
  });

  it("stops at the daily cap", async () => {
    const w = await world();
    await w.settings({ daily_send_cap: 2, test_to: TEST_TO });
    await w.startRun(["a.com", "b.com", "c.com"]);
    const a = await w.toDrafted("a.com");
    const b = await w.toDrafted("b.com");
    const c = await w.toDrafted("c.com");
    expect((await reserve(w, a.emailId)).ok).toBe(true);
    expect((await reserve(w, b.emailId)).ok).toBe(true);
    expect(await reserve(w, c.emailId)).toEqual({ ok: false, reason: "cap_reached" });
    expect((await email(w, c.emailId)).status).toBe("drafted");
  });

  it("counts unknown and sent sends toward the cap, but not yesterday's", async () => {
    const w = await world();
    await w.settings({ daily_send_cap: 1, test_to: TEST_TO });
    await w.startRun(["a.com", "b.com"]);
    const a = await w.toDrafted("a.com");
    const b = await w.toDrafted("b.com");
    await reserve(w, a.emailId);
    await w.s.worker.query("select * from public.set_email_status($1, 'unknown', null, null, 'timed out')", [a.emailId]);
    expect(await reserve(w, b.emailId)).toEqual({ ok: false, reason: "cap_reached" });
    await w.db.admin("update public.emails set sending_at = now() - interval '2 days' where id = $1", [a.emailId]);
    expect((await reserve(w, b.emailId)).ok).toBe(true);
  });

  it("allows only one email per domain within the cooldown, across runs", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const first = await w.toDrafted("acme.com");
    await reserve(w, first.emailId);
    await w.s.worker.query("select * from public.set_email_status($1, 'sent', 'm1', 't1')", [first.emailId]);
    const run2 = await w.startRun(["acme.com"]);
    const second = (await w.prospects(run2))[0]!;
    expect(second).toMatchObject({ lane: "skipped", lane_reason: "Already mailed within the last 30 days" });
  });

  it("lets only one of two drafts for the same domain send, even when both were queued before either sent", async () => {
    const w = await world();
    const run1 = await w.startRun(["acme.com"]);
    const first = await w.toDrafted("acme.com", "worker");
    const run2 = await w.startRun(["acme.com"]); // allowed: nothing has been sent yet
    expect(run2).not.toBe(run1);
    const second = await w.toDrafted("acme.com", "worker2");
    expect(second.prospect.run_id).toBe(run2);
    expect((await reserve(w, first.emailId, "worker")).ok).toBe(true);
    expect(await reserve(w, second.emailId, "worker2")).toEqual({ ok: false, reason: "domain_recently_mailed" });
    expect((await email(w, second.emailId)).status).toBe("drafted");
  });

  it("gives up after three attempts", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const { emailId, prospect } = await w.toDrafted("acme.com");
    for (let i = 1; i <= 3; i += 1) {
      expect((await reserve(w, emailId)).ok, `attempt ${i}`).toBe(true);
      await w.s.worker.query("select * from public.set_email_status($1, 'failed', null, null, 'bad token', true)", [emailId]);
      await w.db.admin("update public.prospects set next_run_at = now(), leased_by = $2, lease_until = now() + interval '5 minutes' where id = $1", [prospect.id, w.u.worker]);
    }
    expect(await reserve(w, emailId)).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("is backed by a unique index: two live emails for one prospect cannot exist, whatever the code does", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const p = await w.claim();
    const [e1] = await w.s.worker.query<{ id: string }>("insert into public.emails (prospect_id, domain, subject, body, attempt) values ($1, 'x', 's', 'b', 1) returning id", [p!.id]);
    const [e2] = await w.s.worker.query<{ id: string }>("insert into public.emails (prospect_id, domain, subject, body, attempt) values ($1, 'x', 's', 'b', 2) returning id", [p!.id]);
    await w.db.admin("update public.emails set status = 'sending', sending_at = now() where id = $1", [e1!.id]);
    await expect(w.db.admin("update public.emails set status = 'sending', sending_at = now() where id = $1", [e2!.id])).rejects.toThrow(/duplicate key/);
    await w.db.admin("update public.emails set status = 'sent' where id = $1", [e1!.id]);
    await expect(w.db.admin("update public.emails set status = 'sending', sending_at = now() where id = $1", [e2!.id])).rejects.toThrow(/duplicate key/);
  });
});

describe("set_email_status", () => {
  async function sending(w: World, domain = "acme.com") {
    await w.startRun([domain]);
    const d = await w.toDrafted(domain);
    await reserve(w, d.emailId);
    return d;
  }

  it("records a confirmed send: the prospect is done and a send is counted", async () => {
    const w = await world();
    const { emailId, prospect } = await sending(w);
    const [e] = await w.s.worker.query<Email>("select * from public.set_email_status($1, 'sent', 'gmail-1', 'thread-1')", [emailId]);
    expect(e).toMatchObject({ status: "sent", gmail_message_id: "gmail-1" });
    expect(await prospectOf(w, "acme.com")).toMatchObject({ step: "sent", lane: "sent", leased_by: null });
    const [n] = await w.db.admin<{ n: number }>("select count(*)::int n from public.usage_ledger where kind = 'gmail_send' and prospect_id = $1", [prospect.id]);
    expect(n!.n).toBe(1);
  });

  it("schedules a retry with backoff after a clear, retryable failure, and the prospect stays drafted", async () => {
    const w = await world();
    const { emailId } = await sending(w);
    await w.s.worker.query("select * from public.set_email_status($1, 'failed', null, null, 'Gmail rate limit', true)", [emailId]);
    const p = await prospectOf(w, "acme.com");
    expect(p).toMatchObject({ step: "drafted", lane: "active" });
    expect(new Date(p.next_run_at).getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await w.claim()).toBeUndefined();
  });

  it("fails the prospect when the failure is not retryable", async () => {
    const w = await world();
    const { emailId } = await sending(w);
    await w.s.worker.query("select * from public.set_email_status($1, 'failed', null, null, 'Token revoked', false)", [emailId]);
    expect(await prospectOf(w, "acme.com")).toMatchObject({ lane: "failed", lane_reason: "Token revoked" });
  });

  it("puts an uncertain send in the unknown lane, where nothing will ever retry it", async () => {
    const w = await world();
    const { emailId } = await sending(w);
    await w.s.worker.query("select * from public.set_email_status($1, 'unknown', null, null, 'Gmail timed out')", [emailId]);
    expect(await prospectOf(w, "acme.com")).toMatchObject({ lane: "unknown", lane_reason: "Gmail timed out" });
    await w.db.admin("update public.prospects set next_run_at = now() - interval '1 day'");
    expect(await w.claim()).toBeUndefined();
    // Without a lease nothing can even ask; and with one (granted here by the owner) the email is still not sendable.
    await expect(w.s.worker.query("select public.reserve_send($1)", [emailId])).rejects.toThrow(/lease_lost/);
    await w.db.admin("update public.prospects set leased_by = $1, lease_until = now() + interval '5 minutes'", [w.u.worker]);
    expect(await reserve(w, emailId)).toEqual({ ok: false, reason: "not_sendable" });
  });

  it("lets only a person resolve an unknown send, with a reason, which is recorded as a decision", async () => {
    const w = await world();
    const { emailId } = await sending(w);
    await w.s.worker.query("select * from public.set_email_status($1, 'unknown', null, null, 'Gmail timed out')", [emailId]);
    await expect(w.s.worker.query("select * from public.set_email_status($1, 'failed', null, null, 'x', false, 'I looked')", [emailId])).rejects.toThrow(/Only a person/);
    await expect(w.s.operator.query("select * from public.set_email_status($1, 'sent', 'g-9', 't-9')", [emailId])).rejects.toThrow(/reason is required/);
    await w.s.operator.query("select * from public.set_email_status($1, 'sent', 'g-9', 't-9', null, false, 'Found it in Sent, header matches')", [emailId]);
    expect(await prospectOf(w, "acme.com")).toMatchObject({ step: "sent", lane: "sent" });
    const [d] = await w.db.admin<{ kind: string; reason: string; created_by: string }>("select kind, reason, created_by from public.decisions");
    expect(d).toMatchObject({ kind: "resolve_unknown_sent", reason: "Found it in Sent, header matches", created_by: w.u.operator });
  });

  it("can mark an unknown send as not sent, which lets the prospect be reviewed", async () => {
    const w = await world();
    const { emailId } = await sending(w);
    await w.s.worker.query("select * from public.set_email_status($1, 'unknown')", [emailId]);
    await w.s.admin.query("select * from public.set_email_status($1, 'failed', null, null, 'Not in Sent', false, 'Checked Sent, nothing there')", [emailId]);
    expect(await prospectOf(w, "acme.com")).toMatchObject({ lane: "failed" });
    expect((await w.db.admin<{ kind: string }>("select kind from public.decisions"))[0]!.kind).toBe("resolve_unknown_failed");
  });

  it("refuses an impossible change", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const { emailId } = await w.toDrafted("acme.com");
    await expect(w.s.worker.query("select * from public.set_email_status($1, 'sent', 'g', 't')", [emailId])).rejects.toThrow(/drafted cannot be set to sent/);
    await expect(w.s.worker.query("select * from public.set_email_status($1, 'sending')", [emailId])).rejects.toThrow(/Cannot set status/);
    await reserve(w, emailId);
    await w.s.worker.query("select * from public.set_email_status($1, 'sent', 'g', 't')", [emailId]);
    await expect(w.s.worker.query("select * from public.set_email_status($1, 'failed')", [emailId])).rejects.toThrow(/sent cannot be set to failed/);
  });
});

describe("sweep_stuck_sends", () => {
  it("turns a send that was reserved but never reported into unknown, never into failed", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const { emailId } = await w.toDrafted("acme.com");
    await reserve(w, emailId);
    expect((await w.s.worker.query<{ n: number }>("select public.sweep_stuck_sends(10) n"))[0]!.n).toBe(0); // too recent to touch
    await w.db.admin("update public.emails set sending_at = now() - interval '11 minutes' where id = $1", [emailId]);
    const [r] = await w.s.worker.query<{ sweep_stuck_sends: number }>("select public.sweep_stuck_sends(10)");
    expect(r!.sweep_stuck_sends).toBe(1);
    expect((await email(w, emailId)).status).toBe("unknown");
    expect(await prospectOf(w, "acme.com")).toMatchObject({ lane: "unknown" });
    expect((await w.s.worker.query<{ sweep_stuck_sends: number }>("select public.sweep_stuck_sends(10)"))[0]!.sweep_stuck_sends).toBe(0);
  });
});

describe("the email status state machine, checked for every pair", () => {
  const STATES = ["drafted", "held", "sending", "sent", "unknown", "failed"] as const;
  // The only paths that exist. Anything else must be refused by the table itself, whoever asks.
  const LEGAL = new Set(["drafted>sending", "failed>sending", "sending>sent", "sending>unknown", "sending>failed", "unknown>sent", "unknown>failed", "held>drafted"]);

  it("allows exactly the legal changes and refuses all the rest, even for the database owner", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const p = await w.claim();
    const [e] = await w.s.worker.query<{ id: string }>("insert into public.emails (prospect_id, domain, subject, body) values ($1, 'x', 's', 'b') returning id", [p!.id]);
    const force = async (status: string) => {
      await w.db.admin("alter table public.emails disable trigger emails_guard_update");
      await w.db.admin("update public.emails set status = $2, sending_at = now() where id = $1", [e!.id, status]);
      await w.db.admin("alter table public.emails enable trigger emails_guard_update");
    };
    for (const from of STATES) {
      for (const to of STATES) {
        if (from === to) continue;
        await force(from);
        const err = await w.db.admin("update public.emails set status = $2 where id = $1", [e!.id, to]).then(() => null, (x: Error) => x.message);
        if (LEGAL.has(`${from}>${to}`)) expect(err, `${from} to ${to} should be allowed`).toBeNull();
        else expect(err, `${from} to ${to} should be refused`).toMatch(/Illegal email status change/);
      }
    }
  });
});
