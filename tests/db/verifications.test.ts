import { describe, expect, it } from "vitest";
import { world } from "./world";

async function withContact() {
  const w = await world();
  const run = await w.startRun(["acme.com"]);
  const [p] = await w.prospects(run);
  await w.db.admin("insert into public.contacts (prospect_id, source, first_name, last_name, position, email, confidence, verification, chosen) values ($1, 'hunter', 'Priya', 'Rao', 'CTO', 'priya@acme.com', 80, 'accept_all', true)", [p!.id]);
  const [c] = await w.db.admin<{ id: string }>("select id from public.contacts where prospect_id = $1", [p!.id]);
  return { w, run, prospect: p!.id, contact: c!.id };
}
const verify = (w: Awaited<ReturnType<typeof world>>, who: "operator" | "admin" | "viewer" | "worker" | "pending", contact: string, status = "valid", score = 95, credits = 1) =>
  w.s[who].query("select * from public.record_verification($1, $2, $3, $4)", [contact, status, score, credits]);

describe("checking an address", () => {
  it("is recorded by an operator or an admin, and by nobody else", async () => {
    const { w, contact } = await withContact();
    await verify(w, "operator", contact);
    await verify(w, "admin", contact, "invalid", 5);
    for (const who of ["viewer", "worker", "pending"] as const) await expect(verify(w, who, contact), who).rejects.toThrow(/Only an operator|permission denied|row-level/);
    expect((await w.db.admin("select * from public.contact_verifications")).length).toBe(2);
  });

  it("keeps the outcome, who recorded it and the credit it used, and never the address itself", async () => {
    const { w, contact, prospect } = await withContact();
    await verify(w, "operator", contact, "valid", 96, 1);
    const [r] = await w.db.admin<Record<string, unknown>>("select * from public.contact_verifications");
    expect(r).toMatchObject({ prospect_id: prospect, contact_id: contact, status: "valid", score: 96, created_by: w.u.operator });
    expect(Object.keys(r!)).not.toEqual(expect.arrayContaining(["email"]));
    expect(JSON.stringify(r)).not.toMatch(/priya|acme\.com/i);
  });

  it("writes the credit it used to the usage ledger, so cost views and budgets see it", async () => {
    const { w, contact, run } = await withContact();
    await verify(w, "operator", contact, "valid", 96, 1);
    const [u] = await w.db.admin<{ kind: string; units: string; note: string; run_id: string }>("select * from public.usage_ledger where kind = 'hunter_credits' order by id desc limit 1");
    expect(u).toMatchObject({ kind: "hunter_credits", note: "Address verification", run_id: run });
    expect(Number(u!.units)).toBe(1);
  });

  it("refuses an unknown contact, an unknown status and an out-of-range score", async () => {
    const { w, contact } = await withContact();
    await expect(verify(w, "operator", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/Unknown contact/);
    await expect(verify(w, "operator", contact, "deliverable")).rejects.toThrow(/check constraint|violates/);
    await expect(verify(w, "operator", contact, "valid", 150)).rejects.toThrow(/check constraint|violates/);
    expect(await w.db.admin("select * from public.contact_verifications")).toEqual([]);
  });

  it("keeps every check: the newest decides, and nothing can be edited or removed", async () => {
    const { w, contact } = await withContact();
    await verify(w, "operator", contact, "accept_all", 55);
    await verify(w, "operator", contact, "valid", 97);
    const [n] = await w.db.admin<{ status: string }>("select status from public.contact_verifications order by seq desc limit 1");
    expect(n!.status).toBe("valid");
    await expect(w.db.admin("update public.contact_verifications set status = 'invalid'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.contact_verifications")).rejects.toThrow(/append-only/);
  });

  it("can be read by a viewer, but written by nobody directly", async () => {
    const { w, contact, prospect } = await withContact();
    await verify(w, "operator", contact);
    expect((await w.s.viewer.query("select * from public.contact_verifications")).length).toBe(1);
    expect(await w.s.pending.query("select * from public.contact_verifications")).toEqual([]);
    await expect(w.s.operator.query("insert into public.contact_verifications (prospect_id, contact_id, status) values ($1, $2, 'valid')", [prospect, contact])).rejects.toThrow(/permission denied|row-level/);
  });
});
