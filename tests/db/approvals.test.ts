import { describe, expect, it } from "vitest";
import { world, type World } from "./world";

/** A draft waiting for a person: drafted, and parked in review by the worker, the way the send step parks it. */
async function waiting(w: World, domain = "acme.com") {
  await w.startRun([domain]);
  const { prospect, emailId } = await w.toDrafted(domain);
  await w.s.worker.query("select * from public.park_prospect($1, 'drafted', 'review', 'Draft ready for approval')", [prospect.id]);
  return { id: prospect.id, emailId };
}
const lane = async (w: World, id: string) => (await w.db.admin<{ lane: string; lane_reason: string | null }>("select lane, lane_reason from public.prospects where id = $1", [id]))[0]!;
const approve = (w: World, who: "operator" | "admin" | "viewer" | "worker" | "pending", emailId: string, subject = "Subject", body = "Body", ratio = 0, note = "") =>
  w.s[who].query("select * from public.approve_email($1, $2, $3, $4, $5)", [emailId, subject, body, ratio, note]);
const reject = (w: World, who: "operator" | "admin" | "viewer" | "worker", emailId: string, reason = "Weak hook", wrong = false) =>
  w.s[who].query("select * from public.reject_email($1, $2, $3)", [emailId, reason, wrong]);

describe("the approval setting", () => {
  it("is on by default for a new settings version, so a draft waits for a person unless an admin chooses otherwise", async () => {
    const w = await world({ configure: false });
    expect((await w.db.admin<{ require_approval: boolean }>("select require_approval from public.settings_now()"))[0]!.require_approval).toBe(true);
  });
});

describe("approving a draft", () => {
  it("puts the company back in the queue, records who and how, and leaves the draft itself untouched", async () => {
    const w = await world();
    const { id, emailId } = await waiting(w);
    const [r] = await approve(w, "operator", emailId, "Subject", "Body");
    expect(r).toMatchObject({ action: "approve", subject: "Subject", body: "Body", contact_ok: true, created_by: w.u.operator });
    expect(Number((r as { edit_ratio: string }).edit_ratio)).toBe(0);
    expect(await lane(w, id)).toMatchObject({ lane: "active", lane_reason: null });
    expect((await w.db.admin<{ kind: string; reason: string }>("select kind, reason from public.decisions where prospect_id = $1", [id]))[0]).toMatchObject({ kind: "promote", reason: expect.stringMatching(/as written/) });
    const [e] = await w.db.admin<{ subject: string; body: string; status: string }>("select subject, body, status from public.emails where id = $1", [emailId]);
    expect(e).toEqual({ subject: "Subject", body: "Body", status: "drafted" });
  });

  it("keeps the person's edited wording as the text to send, and the measure of the change", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    const [r] = await approve(w, "admin", emailId, "A better subject", "A better body", 0.35, "Sharper opening");
    expect(r).toMatchObject({ subject: "A better subject", body: "A better body", reason: "Sharper opening" });
    expect(Number((r as { edit_ratio: string }).edit_ratio)).toBeCloseTo(0.35);
    const [e] = await w.db.admin<{ subject: string }>("select subject from public.emails where id = $1", [emailId]);
    expect(e!.subject).toBe("Subject");
  });

  it("never lets changed text be reported as unchanged, or unchanged text as changed", async () => {
    const w = await world();
    const a = await waiting(w, "a.com");
    const [changed] = await approve(w, "operator", a.emailId, "Subject!", "Body", 0);
    expect(Number((changed as { edit_ratio: string }).edit_ratio)).toBeGreaterThan(0);
    const b = await waiting(w, "b.com");
    const [same] = await approve(w, "operator", b.emailId, "Subject", "Body", 0.9);
    expect(Number((same as { edit_ratio: string }).edit_ratio)).toBe(0);
  });

  it("clamps an out-of-range measure instead of trusting it", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    const [r] = await approve(w, "operator", emailId, "S2", "B2", 7);
    expect(Number((r as { edit_ratio: string }).edit_ratio)).toBe(1);
  });

  it("refuses an empty subject or body", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    await expect(approve(w, "operator", emailId, "  ", "Body")).rejects.toThrow(/cannot be empty/);
    await expect(approve(w, "operator", emailId, "Subject", "")).rejects.toThrow(/cannot be empty/);
  });

  it("refuses a second decision on the same draft", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    await approve(w, "operator", emailId);
    await expect(approve(w, "operator", emailId)).rejects.toThrow(/not waiting|already been decided/);
    await expect(reject(w, "operator", emailId)).rejects.toThrow(/not waiting|already been decided/);
  });

  it("refuses a company that is not waiting for approval", async () => {
    const w = await world();
    await w.startRun(["busy.com"]);
    const { prospect, emailId } = await w.toDrafted("busy.com"); // drafted but still active, not parked for review
    expect(prospect.lane).toBe("active");
    await expect(approve(w, "operator", emailId)).rejects.toThrow(/not waiting for approval/);
  });
});

describe("rejecting a draft", () => {
  it("rules the company out for now, with the reason, and records a skip", async () => {
    const w = await world();
    const { id, emailId } = await waiting(w);
    const [r] = await reject(w, "operator", emailId, "The hook is weak");
    expect(r).toMatchObject({ action: "reject", reason: "The hook is weak", contact_ok: true });
    expect(await lane(w, id)).toMatchObject({ lane: "skipped", lane_reason: "Rejected at review: The hook is weak" });
    expect((await w.db.admin<{ kind: string }>("select kind from public.decisions where prospect_id = $1", [id]))[0]!.kind).toBe("skip");
  });

  it("records a wrong contact as such, which is what contact accuracy is measured from", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    const [r] = await reject(w, "admin", emailId, "Wrong person: she left the company", true);
    expect(r).toMatchObject({ contact_ok: false });
  });

  it("needs a reason", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    await expect(reject(w, "operator", emailId, "  ")).rejects.toThrow(/reason is required/);
  });
});

describe("who may decide", () => {
  it.each(["viewer", "worker", "pending"] as const)("refuses %s", async (who) => {
    const w = await world();
    const { emailId } = await waiting(w);
    await expect(approve(w, who === "pending" ? "pending" : who, emailId)).rejects.toThrow(/Only an operator or admin/);
    if (who !== "pending") await expect(reject(w, who, emailId)).rejects.toThrow(/Only an operator or admin/);
  });

  it("gives nobody a direct way to write a review, not even an admin or the worker", async () => {
    const w = await world();
    const { id, emailId } = await waiting(w);
    for (const who of ["admin", "operator", "worker"] as const) {
      await expect(w.s[who].query("insert into public.email_reviews (email_id, prospect_id, action, subject, body) values ($1, $2, 'approve', 's', 'b')", [emailId, id])).rejects.toThrow(/permission denied/);
    }
  });

  it("lets a viewer read decisions, and an outsider read nothing", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    await approve(w, "operator", emailId);
    expect(await w.s.viewer.query("select * from public.email_reviews")).toHaveLength(1);
    expect(await w.s.pending.query("select * from public.email_reviews")).toHaveLength(0);
    expect(await w.db.as(null, "anon").error("select * from public.email_reviews")).toMatch(/permission denied/);
  });
});

describe("the record", () => {
  it("cannot be rewritten or removed", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    await approve(w, "operator", emailId);
    await expect(w.db.admin("update public.email_reviews set edit_ratio = 0.9")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.email_reviews")).rejects.toThrow(/append-only/);
    await expect(w.s.admin.query("update public.email_reviews set edit_ratio = 0.9")).rejects.toThrow(/permission denied/);
  });

  it("holds an edit measure between 0 and 1, and a reason under 300 characters", async () => {
    const w = await world();
    const { id, emailId } = await waiting(w);
    await expect(w.db.admin("insert into public.email_reviews (email_id, prospect_id, action, subject, body, edit_ratio) values ($1, $2, 'approve', 's', 'b', 1.5)", [emailId, id])).rejects.toThrow(/violates check constraint/);
    await expect(w.db.admin("insert into public.email_reviews (email_id, prospect_id, action, subject, body, reason) values ($1, $2, 'approve', 's', 'b', $3)", [emailId, id, "x".repeat(301)])).rejects.toThrow(/violates check constraint/);
  });
});
