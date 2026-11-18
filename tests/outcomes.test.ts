import { describe, expect, it } from "vitest";
import { getDemo } from "@/lib/demo/world";
import { pgPort } from "@/lib/db/pg-port";
import { isCallable, listLeads } from "@/lib/app/leads";
import { computeImpact, rangeFor, renderReport, type ImpactInput } from "@/lib/app/impact";
import { dayOf, followUpOf, followUpText, isOutcome, OUTCOME_BY_ID, OUTCOMES, standings, summarise, type OutcomeRow } from "@/lib/app/outcomes";

const row = (prospect_id: string, status: string, seq: number, extra: Partial<OutcomeRow> = {}): OutcomeRow => ({ prospect_id, seq, status, note: "", follow_up_on: null, created_at: "2026-11-18T10:00:00Z", ...extra });

describe("where a lead stands", () => {
  it("is the newest row for each company, by sequence and not by clock", () => {
    const m = standings([row("a", "reached_out", 1), row("a", "replied", 3), row("a", "meeting_booked", 2), row("b", "not_interested", 1)]);
    expect(m.get("a")!.status).toBe("replied");
    expect(m.get("b")!.status).toBe("not_interested");
    expect(m.size).toBe(2);
  });

  it("treats a sequence that arrives as text (Postgres bigint) as a number, so 10 is newer than 9", () => {
    expect(standings([row("a", "reached_out", "9" as never), row("a", "replied", "10" as never)]).get("a")!.status).toBe("replied");
  });

  it("ignores an outcome it does not know instead of guessing", () => {
    expect(standings([row("a", "reached_out", 1), row("a", "mystery", 2)]).get("a")!.status).toBe("reached_out");
    expect(isOutcome("replied")).toBe(true);
    expect(isOutcome("mystery")).toBe(false);
  });

  it("names every outcome, with what it means, and says which are open", () => {
    expect(OUTCOMES.map((o) => o.id)).toEqual(["reached_out", "replied", "meeting_booked", "not_interested", "bounced", "wrong_person"]);
    expect(OUTCOMES.filter((o) => o.open).map((o) => o.id)).toEqual(["reached_out", "replied", "meeting_booked"]);
    for (const o of OUTCOMES) expect(o.help.length).toBeGreaterThan(10);
  });
});

describe("follow-ups", () => {
  const at = (status: string, on: string | null) => standings([row("a", status, 1, { follow_up_on: on })]).get("a")!;
  it("tells overdue, today and upcoming apart, by whole days", () => {
    expect(followUpOf(at("reached_out", "2026-11-17"), "2026-11-20")).toMatchObject({ state: "overdue", days: -3 });
    expect(followUpOf(at("reached_out", "2026-11-20"), "2026-11-20")).toMatchObject({ state: "today", days: 0 });
    expect(followUpOf(at("replied", "2026-11-22"), "2026-11-20")).toMatchObject({ state: "upcoming", days: 2 });
  });

  it("says it in words", () => {
    expect(followUpText({ state: "overdue", on: "x", days: -1 })).toBe("Follow-up overdue by 1 day");
    expect(followUpText({ state: "overdue", on: "x", days: -4 })).toBe("Follow-up overdue by 4 days");
    expect(followUpText({ state: "today", on: "x", days: 0 })).toBe("Follow up today");
    expect(followUpText({ state: "upcoming", on: "x", days: 1 })).toBe("Follow up in 1 day");
    expect(followUpText({ state: "upcoming", on: "x", days: 5 })).toBe("Follow up in 5 days");
  });

  it("has none for a closed lead, whatever an old date says, nor without a date", () => {
    expect(followUpOf(at("not_interested", "2026-11-25"), "2026-11-20")).toBeNull();
    expect(followUpOf(at("reached_out", null), "2026-11-20")).toBeNull();
    expect(followUpOf(null, "2026-11-20")).toBeNull();
  });

  it("uses the person's own calendar day", () => {
    expect(dayOf(new Date(2026, 10, 5, 23, 59))).toBe("2026-11-05");
    expect(dayOf(new Date(2026, 0, 2, 0, 1))).toBe("2026-01-02");
  });
});

describe("summarise", () => {
  const rows = [row("a", "reached_out", 1), row("a", "replied", 2), row("a", "meeting_booked", 3), row("b", "reached_out", 4), row("b", "not_interested", 5), row("c", "bounced", 6), row("d", "wrong_person", 7)];
  it("counts companies that ever reached a stage, so a meeting that went quiet is still a meeting", () => {
    expect(summarise(rows)).toEqual({ recorded: true, reached: 4, replied: 1, meetings: 1, notInterested: 1, bounced: 1, wrongPerson: 1 });
  });
  it("counts a company once however many times it was recorded", () => {
    expect(summarise([row("a", "replied", 1), row("a", "replied", 2)]).replied).toBe(1);
  });
  it("says nothing is recorded when nothing is", () => {
    expect(summarise([])).toMatchObject({ recorded: false, reached: 0 });
  });
});

describe("the Impact view's results", () => {
  const NOW = Date.parse("2026-11-04T12:00:00Z");
  const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const input = (outcomes: OutcomeRow[]): ImpactInput => ({
    range: rangeFor("30", NOW), assumptions: { manualMinutes: 20, reviewMinutesPerEmail: 1.5, reviewMinutesPerDecision: 2 },
    prospects: ["a", "b", "c"].map((id) => ({ id, lane: "sent", lane_reason: null, verdict: "qualified", created_at: day(1) })),
    events: [], draftEvents: [], facts: [], pages: [], usage: [], decisions: [], outcomes,
  });

  it("measures replies and meetings as a share of the companies reached, with the working", () => {
    const x = computeImpact(input([row("a", "reached_out", 1), row("a", "replied", 2), row("b", "reached_out", 3), row("b", "meeting_booked", 4), row("c", "reached_out", 5)]));
    expect(x.results).toMatchObject({ recorded: true, reached: 3, replied: 1, meetings: 1 });
    expect(x.results.replyRate).toEqual({ value: 1 / 3, numerator: 1, denominator: 3 });
    expect(x.results.meetingRate.numerator).toBe(1);
  });

  it("says plainly that nothing is recorded, and gives no rate, when there are no outcomes (or the input predates them)", () => {
    const empty = computeImpact(input([]));
    expect(empty.results.recorded).toBe(false);
    expect(empty.results.replyRate.value).toBeNull();
    expect(empty.notes.join(" ")).toMatch(/No outcomes have been recorded/);
    const old = input([]);
    delete old.outcomes;
    expect(computeImpact(old).results.recorded).toBe(false);
  });

  it("counts only companies added in the period", () => {
    const x = computeImpact({ ...input([row("old", "replied", 1)]), prospects: [{ id: "a", lane: "sent", lane_reason: null, verdict: null, created_at: day(1) }] });
    expect(x.results.recorded).toBe(false);
  });

  it("puts the results in the weekly report only when there are some", () => {
    const when = { from: "x", to: "y" };
    expect(renderReport(computeImpact(input([])), when)).not.toContain("After the outreach");
    const text = renderReport(computeImpact(input([row("a", "reached_out", 1), row("a", "replied", 2)])), when);
    expect(text).toContain("After the outreach");
    expect(text).toContain("Companies reached: 1");
    expect(text).toContain("Replied: 1 (100%");
  });
});

describe("outcomes on Leads, from the demo world", () => {
  it("shows where a lead stands and who needs a follow-up, and drops a clear no from 'worth a call'", async () => {
    const w = await getDemo();
    const op = pgPort(w.db.as(w.users.operator));
    const leads0 = await listLeads(op, true);
    const nw = leads0.find((l) => l.domain === "northwind.io")!;
    const lumen = leads0.find((l) => l.domain === "lumenhealth.com")!;
    expect(nw.outcome).toBeNull();

    const tomorrow = dayOf(Date.now() + 86_400_000);
    await op.rpc("log_outcome", { p_prospect: nw.id, p_status: "reached_out", p_note: "Left a message", p_follow_up: tomorrow, p_do_not_contact: false });
    await op.rpc("log_outcome", { p_prospect: lumen.id, p_status: "not_interested", p_note: "No budget", p_follow_up: null, p_do_not_contact: false });

    const leads = await listLeads(op, true);
    const a = leads.find((l) => l.domain === "northwind.io")!;
    expect(a.outcome).toMatchObject({ status: "reached_out", note: "Left a message", followUpOn: tomorrow });
    expect(followUpOf(a.outcome, dayOf(Date.now()))).toMatchObject({ state: "upcoming", days: 1 });
    expect(isCallable(a)).toBe(true);
    const b = leads.find((l) => l.domain === "lumenhealth.com")!;
    expect(b.outcome!.status).toBe("not_interested");
    expect(isCallable(b)).toBe(false);
    expect(OUTCOME_BY_ID[b.outcome!.status].open).toBe(false);
  }, 60_000);

  it("lets a viewer see the outcomes but not record one", async () => {
    const w = await getDemo();
    const viewer = pgPort(w.db.as(w.users.viewer));
    const leads = await listLeads(viewer, false);
    expect(leads.find((l) => l.domain === "northwind.io")!.outcome?.status).toBe("reached_out");
    const [p] = await w.db.admin<{ id: string }>("select id from public.prospects where domain = 'harborpay.com' limit 1");
    await expect(viewer.rpc("log_outcome", { p_prospect: p!.id, p_status: "replied", p_note: "", p_follow_up: null, p_do_not_contact: false })).rejects.toThrow(/Only an operator/);
  }, 60_000);
});
