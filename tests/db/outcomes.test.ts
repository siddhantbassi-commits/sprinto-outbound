import { describe, expect, it } from "vitest";
import { world, type World } from "./world";

const log = (w: World, who: "operator" | "admin" | "viewer" | "worker" | "pending", prospect: string, status: string, note = "", followUp: string | null = null, dnc = false) =>
  w.s[who].query("select * from public.log_outcome($1, $2, $3, $4::date, $5)", [prospect, status, note, followUp, dnc]);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function one(domain = "acme.com") {
  const w = await world();
  await w.startRun([domain]);
  const [p] = await w.prospects();
  return { w, id: p!.id };
}

describe("recording what came of a lead", () => {
  it("lets an operator or an admin record it, and nobody else", async () => {
    const { w, id } = await one();
    await log(w, "operator", id, "reached_out", "Called, left a message");
    await log(w, "admin", id, "replied");
    for (const who of ["viewer", "worker", "pending"] as const) await expect(log(w, who, id, "reached_out"), who).rejects.toThrow(/Only an operator|permission denied|row-level/);
    expect((await w.db.admin("select * from public.lead_outcomes")).length).toBe(2);
  });

  it("gives nobody a way in except the function, and lets a viewer read", async () => {
    const { w, id } = await one();
    await log(w, "operator", id, "reached_out");
    await expect(w.s.operator.query("insert into public.lead_outcomes (prospect_id, status) values ($1, 'replied')", [id])).rejects.toThrow(/permission denied|row-level/);
    expect((await w.s.viewer.query("select * from public.lead_outcomes")).length).toBe(1);
    expect(await w.s.pending.query("select * from public.lead_outcomes")).toEqual([]);
  });

  it("stamps who recorded it and when, and keeps the history: nothing can be edited or removed", async () => {
    const { w, id } = await one();
    await log(w, "operator", id, "reached_out", "First call");
    await log(w, "operator", id, "meeting_booked", "Tuesday 3pm", inDays(3));
    const rows = await w.db.admin<{ status: string; created_by: string; created_at: string }>("select * from public.lead_outcomes order by seq");
    expect(rows.map((r) => r.status)).toEqual(["reached_out", "meeting_booked"]);
    expect(rows[0]!.created_by).toBe(w.u.operator);
    expect(rows[0]!.created_at).toBeTruthy();
    await expect(w.db.admin("update public.lead_outcomes set status = 'replied'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.lead_outcomes")).rejects.toThrow(/append-only/);
  });

  it("refuses an unknown company and an unknown outcome, and keeps a note to 500 characters", async () => {
    const { w, id } = await one();
    await expect(log(w, "operator", "00000000-0000-0000-0000-000000000000", "replied")).rejects.toThrow(/Unknown company/);
    await expect(log(w, "operator", id, "won_the_lottery")).rejects.toThrow(/Unknown outcome/);
    await log(w, "operator", id, "replied", "x".repeat(600));
    expect((await w.db.admin<{ note: string }>("select note from public.lead_outcomes"))[0]!.note).toHaveLength(500);
  });

  it("accepts a follow-up date for an open lead only, and only a sensible one", async () => {
    const { w, id } = await one();
    await expect(log(w, "operator", id, "reached_out", "", inDays(7))).resolves.toBeTruthy();
    await expect(log(w, "operator", id, "reached_out", "", inDays(-1))).rejects.toThrow(/within the next year/);
    await expect(log(w, "operator", id, "reached_out", "", inDays(400))).rejects.toThrow(/within the next year/);
    await expect(log(w, "operator", id, "not_interested", "", inDays(7))).rejects.toThrow(/closed lead has no follow-up/);
    await expect(log(w, "operator", id, "bounced", "", inDays(7))).rejects.toThrow(/closed lead has no follow-up/);
  });
});

describe("what a reply, a bounce and a refusal also do", () => {
  const kinds = (w: World) => w.db.admin<{ kind: string }>("select kind from public.decisions where kind in ('mark_reply', 'mark_bounce', 'do_not_contact') order by seq").then((r) => r.map((x) => x.kind));

  it("counts a reply and a bounce as the decisions Impact already reads, once per company however often it is recorded", async () => {
    const { w, id } = await one();
    await log(w, "operator", id, "replied");
    await log(w, "operator", id, "replied", "again");
    await log(w, "operator", id, "bounced");
    await log(w, "operator", id, "bounced");
    expect(await kinds(w)).toEqual(["mark_reply", "mark_bounce"]);
  });

  it("records nothing extra for the other outcomes", async () => {
    const { w, id } = await one();
    for (const s of ["reached_out", "meeting_booked", "wrong_person"]) await log(w, "operator", id, s);
    await log(w, "operator", id, "not_interested", "no thanks");
    expect(await kinds(w)).toEqual([]);
    expect(await w.db.admin("select * from public.suppressions where value = 'acme.com'")).toEqual([]);
  });

  it("puts the company on the do-not-contact list when 'not interested' asks for it, so a later run skips it", async () => {
    const { w, id } = await one();
    await log(w, "operator", id, "not_interested", "Asked us to stop", null, true);
    expect(await kinds(w)).toEqual(["do_not_contact"]);
    const [s] = await w.db.admin<{ kind: string; value: string; action: string; reason: string }>("select * from public.suppressions where value = 'acme.com'");
    expect(s).toMatchObject({ kind: "domain", value: "acme.com", action: "add" });
    expect(s!.reason).toBe("Not interested: Asked us to stop");
    const run = await w.startRun(["acme.com"]);
    expect((await w.prospects(run))[0]).toMatchObject({ lane: "skipped" });
  });

  it("does not add a second suppression for a domain already on the list", async () => {
    const { w, id } = await one();
    await log(w, "operator", id, "not_interested", "", null, true);
    await log(w, "operator", id, "not_interested", "", null, true);
    expect((await w.db.admin("select * from public.suppressions where value = 'acme.com'")).length).toBe(1);
  });

  it("allows do-not-contact only with 'not interested'", async () => {
    const { w, id } = await one();
    await expect(log(w, "operator", id, "replied", "", null, true)).rejects.toThrow(/Only "not interested"/);
    expect(await w.db.admin("select * from public.lead_outcomes")).toEqual([]);
  });
});
