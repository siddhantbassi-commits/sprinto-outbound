import { describe, expect, it } from "vitest";
import { world, type World } from "./world";

type Who = "operator" | "admin" | "viewer" | "worker" | "pending";
const H = (c: string) => c.repeat(64).slice(0, 64);
const request = (w: World, who: Who, address: string, hash = H("a")) => w.s[who].query("select public.request_reviewer_code($1, $2)", [address, hash]);
const confirm = async (w: World, who: Who, address: string, hash = H("a")) => ((await w.s[who].query<{ confirm_reviewer_code: boolean }>("select public.confirm_reviewer_code($1, $2)", [address, hash]))[0]!.confirm_reviewer_code);
const confirmed = async (w: World, address: string) => ((await w.s.operator.query<{ reviewer_confirmed: boolean }>("select public.reviewer_confirmed($1)", [address]))[0]!.reviewer_confirmed);
const proved = async (w: World, address: string, who: Who = "operator") => { await request(w, who, address); expect(await confirm(w, who, address)).toBe(true); };

async function waiting(w: World, domain = "acme.com") {
  await w.startRun([domain]);
  const { prospect, emailId } = await w.toDrafted(domain);
  await w.s.worker.query("select * from public.park_prospect($1, 'drafted', 'review', 'Draft ready for approval')", [prospect.id]);
  return { id: prospect.id, emailId };
}
const approveTo = (w: World, who: Who, emailId: string, to: string | null) => w.s[who].query("select * from public.approve_email($1, 'Subject', 'Body', 0, '', $2)", [emailId, to]);

describe("proving an address belongs to the reviewer", () => {
  it("lets an operator or an admin ask for and enter a code, and nobody else", async () => {
    const w = await world();
    await request(w, "operator", "prof@uni.edu");
    await request(w, "admin", "other@uni.edu");
    for (const who of ["viewer", "worker", "pending"] as const) {
      await expect(request(w, who, "x@uni.edu"), who).rejects.toThrow(/Only an operator|permission denied/);
      await expect(confirm(w, who, "prof@uni.edu"), who).rejects.toThrow(/Only an operator|permission denied/);
    }
  });

  it("is unreadable through the API for everyone, so nobody can read a pending code", async () => {
    const w = await world();
    await request(w, "operator", "prof@uni.edu");
    for (const who of ["operator", "admin", "viewer", "worker"] as const) {
      await expect(w.s[who].query("select * from public.reviewer_checks"), who).rejects.toThrow(/permission denied/);
      await expect(w.s[who].query("select * from public.email_deliveries"), who).rejects.toThrow(/permission denied/);
      await expect(w.s[who].query("insert into public.reviewer_checks (address, kind) values ('a@b.co', 'confirmed')"), who).rejects.toThrow(/permission denied/);
    }
    expect((await w.db.admin("select * from public.reviewer_checks")).length).toBe(1);
  });

  it("stores only the keyed hash of a code, never anything that reads as a code, and stamps who and when", async () => {
    const w = await world();
    await request(w, "operator", "Prof@Uni.EDU ", H("c"));
    const [row] = await w.db.admin<{ address: string; kind: string; code_hash: string; created_by: string; created_at: string }>("select * from public.reviewer_checks");
    expect(row).toMatchObject({ address: "prof@uni.edu", kind: "requested", code_hash: H("c"), created_by: w.u.operator });
    expect(row!.created_at).toBeTruthy();
    await expect(w.db.admin("update public.reviewer_checks set kind = 'confirmed'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.reviewer_checks")).rejects.toThrow(/append-only/);
  });

  it("refuses an address that is not a plain address, and a malformed code hash", async () => {
    const w = await world();
    for (const bad of ["", "not-an-address", "a b@uni.edu", "x@y", "a@b.c", "<x@uni.edu>", "x@uni.edu, y@uni.edu", "x@uni.edu\nBcc: z@uni.edu"]) {
      await expect(request(w, "operator", bad), JSON.stringify(bad)).rejects.toThrow(/plain email address/);
    }
    await expect(request(w, "operator", "ok@uni.edu", "short")).rejects.toThrow(/could not be prepared/);
    expect(await w.db.admin("select * from public.reviewer_checks")).toEqual([]);
  });

  it("confirms the right code, once for that request, and a confirmation is good for the address", async () => {
    const w = await world();
    expect(await confirmed(w, "prof@uni.edu")).toBe(false);
    await request(w, "operator", "prof@uni.edu", H("a"));
    expect(await confirm(w, "operator", "prof@uni.edu", H("a"))).toBe(true);
    expect(await confirmed(w, "PROF@uni.edu")).toBe(true);
    expect(await confirmed(w, "someone-else@uni.edu")).toBe(false);
    // A used code does not confirm again.
    await expect(confirm(w, "operator", "prof@uni.edu", H("a"))).rejects.toThrow(/no code waiting/);
  });

  it("records a wrong code and refuses the right one after five wrong ones", async () => {
    const w = await world();
    await request(w, "operator", "prof@uni.edu", H("a"));
    for (let i = 0; i < 5; i += 1) expect(await confirm(w, "operator", "prof@uni.edu", H("b"))).toBe(false);
    await expect(confirm(w, "operator", "prof@uni.edu", H("a"))).rejects.toThrow(/Too many wrong codes/);
    expect(await confirmed(w, "prof@uni.edu")).toBe(false);
    expect((await w.db.admin("select * from public.reviewer_checks where kind = 'failed'")).length).toBe(5);
    // A fresh request starts clean.
    await request(w, "operator", "prof@uni.edu", H("d"));
    expect(await confirm(w, "operator", "prof@uni.edu", H("d"))).toBe(true);
  });

  it("does not let a code for one address confirm another", async () => {
    const w = await world();
    await request(w, "operator", "prof@uni.edu", H("a"));
    await expect(confirm(w, "operator", "stranger@uni.edu", H("a"))).rejects.toThrow(/no code waiting/);
    expect(await confirmed(w, "stranger@uni.edu")).toBe(false);
  });

  it("caps new addresses, codes an hour for one address, and codes a day", async () => {
    const w = await world();
    for (const a of ["a1@uni.edu", "a2@uni.edu", "a3@uni.edu"]) await request(w, "operator", a);
    await expect(request(w, "operator", "a4@uni.edu")).rejects.toThrow(/limit of new addresses/);
    // An address already used today may ask again, up to three codes an hour.
    await request(w, "operator", "a1@uni.edu");
    await request(w, "operator", "a1@uni.edu");
    await expect(request(w, "operator", "a1@uni.edu")).rejects.toThrow(/Three codes have already been sent/);
    // Eight codes in a day, across all addresses (5 so far here: a1 x3, a2, a3).
    await request(w, "operator", "a2@uni.edu");
    await request(w, "operator", "a2@uni.edu");
    await request(w, "operator", "a3@uni.edu");
    await expect(request(w, "operator", "a3@uni.edu")).rejects.toThrow(/Three codes|sent all its codes/);
    await expect(request(w, "operator", "a2@uni.edu")).rejects.toThrow(/Three codes|sent all its codes/);
  });
});

describe("approving a draft to a reviewer's address", () => {
  it("records the address with the approval, and the send reservation returns it", async () => {
    const w = await world();
    await proved(w, "prof@uni.edu");
    const { emailId } = await waiting(w);
    await approveTo(w, "operator", emailId, "Prof@Uni.edu");
    expect((await w.db.admin<{ address: string; created_by: string }>("select address, created_by from public.email_deliveries"))[0]).toEqual({ address: "prof@uni.edu", created_by: w.u.operator });
    const prospectId = (await w.db.admin<{ prospect_id: string }>("select prospect_id from public.emails where id = $1", [emailId]))[0]?.prospect_id;
    const lease = await w.s.worker.query("select * from public.claim_next_prospect()");
    expect(lease.length).toBe(1);
    const r = (await w.s.worker.query<{ reserve_send: { ok: boolean; test_to: string; deliver_to: string | null } }>("select public.reserve_send($1) as reserve_send", [emailId]))[0]!.reserve_send;
    expect(r).toMatchObject({ ok: true, deliver_to: "prof@uni.edu" });
    expect(prospectId).toBeTruthy();
  });

  it("refuses an address that was never confirmed, and records nothing of the approval", async () => {
    const w = await world();
    const { id, emailId } = await waiting(w);
    await expect(approveTo(w, "operator", emailId, "stranger@uni.edu")).rejects.toThrow(/not been confirmed/);
    expect(await w.db.admin("select * from public.email_deliveries")).toEqual([]);
    expect(await w.db.admin("select * from public.email_reviews")).toEqual([]);
    expect((await w.db.admin<{ lane: string }>("select lane from public.prospects where id = $1", [id]))[0]!.lane).toBe("review");
  });

  it("sends to the owner as before when no address is named", async () => {
    const w = await world();
    const { emailId } = await waiting(w);
    await approveTo(w, "operator", emailId, null);
    expect(await w.db.admin("select * from public.email_deliveries")).toEqual([]);
    await w.s.worker.query("select * from public.claim_next_prospect()");
    const r = (await w.s.worker.query<{ reserve_send: { ok: boolean; deliver_to: string | null } }>("select public.reserve_send($1) as reserve_send", [emailId]))[0]!.reserve_send;
    expect(r).toMatchObject({ ok: true, deliver_to: null });
  });

  it("only lets an operator or an admin approve, as before", async () => {
    const w = await world();
    await proved(w, "prof@uni.edu");
    const { emailId } = await waiting(w);
    for (const who of ["viewer", "worker", "pending"] as const) await expect(approveTo(w, who, emailId, "prof@uni.edu"), who).rejects.toThrow(/Only an operator|permission denied/);
  });

  it("stops at ten reviewer emails a day", async () => {
    const w = await world();
    await proved(w, "prof@uni.edu");
    for (let i = 0; i < 10; i += 1) {
      const { emailId } = await waiting(w, `company${i}.com`);
      await approveTo(w, "operator", emailId, "prof@uni.edu");
    }
    const { emailId } = await waiting(w, "eleventh.com");
    await expect(approveTo(w, "operator", emailId, "prof@uni.edu")).rejects.toThrow(/limit of 10 emails for today/);
    expect((await w.db.admin("select * from public.email_deliveries")).length).toBe(10);
  }, 120_000);

  it("keeps the delivery record append-only", async () => {
    const w = await world();
    await proved(w, "prof@uni.edu");
    const { emailId } = await waiting(w);
    await approveTo(w, "operator", emailId, "prof@uni.edu");
    await expect(w.db.admin("update public.email_deliveries set address = 'x@y.com'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.email_deliveries")).rejects.toThrow(/append-only/);
  });
});
