import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/app/leads";
import type { OutcomeId, Standing } from "@/lib/app/outcomes";
import { canMoveTo, groupByStage, STAGE_BY_ID, STAGES, stageOf } from "@/lib/app/stages";
import { dateHeading, followUpsDue, nextToCall, pipelineCounts } from "@/lib/app/today";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-18T09:00:00");
const iso = (d: number) => new Date(NOW + d * DAY).toISOString().slice(0, 10);
const outcome = (status: OutcomeId, followUpOn: string | null = null): Standing => ({ status, note: "", followUpOn, at: "2026-11-17T10:00:00Z" });
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({ id, runId: "r", domain: `${id}.io`, name: id.toUpperCase(), verdict: "qualified", score: 70, lane: "sent", updatedAt: "x", reasons: [], contact: { name: "Priya Rao", first: "Priya", last: "Rao", title: "CTO", email: "priya@x.io" }, pains: [], emailStatus: "sent", outcome: null, usesCompetitor: false, ...over });

describe("the stages of a pursuit", () => {
  it("run from 'to contact' through the outcomes, in the order a person thinks of them", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["to_contact", "reached_out", "replied", "meeting_booked", "not_interested", "bounced", "wrong_person"]);
    expect(STAGES.filter((s) => s.closed).map((s) => s.id)).toEqual(["not_interested", "bounced", "wrong_person"]);
    for (const s of STAGES) expect(STAGE_BY_ID[s.id].label).toBe(s.label);
  });

  it("puts a lead worth a call with nothing recorded in 'to contact', and one that is not worth a call nowhere", () => {
    expect(stageOf(lead("a"))).toBe("to_contact");
    expect(stageOf(lead("b", { verdict: "maybe" }))).toBe("to_contact");
    expect(stageOf(lead("c", { verdict: "not_fit" }))).toBeNull();
    expect(stageOf(lead("d", { verdict: null }))).toBeNull();
  });

  it("puts a lead where its newest outcome says, whatever its score", () => {
    expect(stageOf(lead("a", { outcome: outcome("replied") }))).toBe("replied");
    expect(stageOf(lead("b", { verdict: "not_fit", outcome: outcome("meeting_booked") }))).toBe("meeting_booked");
    expect(stageOf(lead("c", { outcome: outcome("not_interested") }))).toBe("not_interested");
  });

  it("groups every lead once, keeps empty stages, and drops those in no stage", () => {
    const g = groupByStage([lead("a"), lead("b"), lead("c", { outcome: outcome("reached_out") }), lead("d", { verdict: "not_fit" })]);
    expect(Object.keys(g)).toHaveLength(STAGES.length);
    expect(g.to_contact.map((l) => l.id)).toEqual(["a", "b"]);
    expect(g.reached_out.map((l) => l.id)).toEqual(["c"]);
    expect(g.replied).toEqual([]);
    expect(Object.values(g).flat()).toHaveLength(3);
  });

  it("lets a card be moved to any outcome, never back to 'to contact'", () => {
    expect(canMoveTo("replied")).toBe(true);
    expect(canMoveTo("not_interested")).toBe(true);
    expect(canMoveTo("to_contact")).toBe(false);
  });
});

describe("what Today shows", () => {
  it("lists follow-ups due within a week, overdue first, then soonest, and leaves out later ones and closed leads", () => {
    const leads = [
      lead("soon", { outcome: outcome("reached_out", iso(2)) }),
      lead("late", { outcome: outcome("replied", iso(-3)) }),
      lead("today", { outcome: outcome("meeting_booked", iso(0)) }),
      lead("later", { outcome: outcome("reached_out", iso(30)) }),
      lead("closed", { outcome: outcome("not_interested", iso(1)) }),
      lead("none", { outcome: outcome("reached_out") }),
    ];
    const f = followUpsDue(leads, NOW);
    expect(f.map((x) => x.id)).toEqual(["late", "today", "soon"]);
    expect(f[0]!.followUp).toMatchObject({ state: "overdue", days: -3 });
    expect(f[2]!.contact).toBe("Priya Rao");
    expect(followUpsDue(leads, NOW, 60).map((x) => x.id)).toEqual(["late", "today", "soon", "later"]);
  });

  it("counts the pursuit by stage in the same order as the board", () => {
    const c = pipelineCounts([lead("a"), lead("b", { outcome: outcome("replied") }), lead("c", { outcome: outcome("replied") })]);
    expect(c.map((x) => x.id)).toEqual(STAGES.map((s) => s.id));
    expect(Object.fromEntries(c.map((x) => [x.id, x.count]))).toMatchObject({ to_contact: 1, replied: 2, reached_out: 0 });
  });

  it("suggests the best uncontacted leads first, and not ones already contacted or not worth a call", () => {
    const leads = [lead("low", { score: 50 }), lead("high", { score: 92 }), lead("mid", { score: 70 }), lead("done", { score: 99, outcome: outcome("reached_out") }), lead("nofit", { score: 98, verdict: "not_fit" })];
    expect(nextToCall(leads, 3).map((l) => l.id)).toEqual(["high", "mid", "low"]);
    expect(nextToCall(leads, 1)).toHaveLength(1);
  });

  it("writes the date the way a person would say it", () => {
    expect(dateHeading(Date.parse("2026-11-18T09:00:00"))).toMatch(/Wednesday.*18.*November/);
  });
});
