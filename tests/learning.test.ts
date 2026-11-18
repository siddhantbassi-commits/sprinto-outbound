import { describe, expect, it } from "vitest";
import { learnFromOutcomes, MIN_GROUP, MIN_REACHED, NOTABLE_GAP, rateText, type LearnProspect } from "@/lib/app/learning";
import type { OutcomeRow } from "@/lib/app/outcomes";

let seq = 0;
const row = (prospect_id: string, status: string): OutcomeRow => ({ prospect_id, seq: ++seq, status, note: "", follow_up_on: null, created_at: "2026-11-18T10:00:00Z" });
const p = (id: string, signals: string[], score = 70): LearnProspect => ({ id, score, parts: signals.map((s) => ({ id: s, label: `Signal ${s}`, points: 10 })) });

/** n companies, the first `positive` of which replied, all reached. */
function batch(prefix: string, n: number, positive: number, signals: string[], score = 70) {
  const ps = Array.from({ length: n }, (_, i) => p(`${prefix}${i}`, signals, score));
  const out = ps.flatMap((x, i) => [row(x.id, "reached_out"), ...(i < positive ? [row(x.id, "replied")] : [])]);
  return { ps, out };
}

describe("learning from outcomes", () => {
  it("shows no pattern until enough companies have been reached, and says how many more are needed", () => {
    const { ps, out } = batch("a", MIN_REACHED - 3, 3, ["cert"]);
    const l = learnFromOutcomes(ps, out);
    expect(l.ready).toBe(false);
    expect(l.needed).toBe(3);
    expect(l.insights).toEqual([]);
    expect(l.scoreSplit).toBeNull();
    expect(l.funnel).toMatchObject({ reached: MIN_REACHED - 3, replied: 3, positive: 3 });
  });

  it("counts the funnel by company, once however many outcomes a company has, and ignores unknown outcomes", () => {
    const ps = [p("a", []), p("b", []), p("c", [])];
    const l = learnFromOutcomes(ps, [row("a", "reached_out"), row("a", "replied"), row("a", "replied"), row("a", "meeting_booked"), row("b", "reached_out"), row("b", "mystery"), row("c", "mystery")]);
    expect(l.funnel).toEqual({ reached: 2, replied: 1, meetings: 1, positive: 1 });
  });

  it("ignores outcomes recorded for a company it has no scores for", () => {
    const l = learnFromOutcomes([p("a", [])], [row("a", "replied"), row("ghost", "replied")]);
    expect(l.funnel).toMatchObject({ reached: 1, replied: 1 });
  });

  it("finds a signal that went with replies, naming both samples, once the groups are big enough", () => {
    const withIt = batch("w", 6, 4, ["cert"]);   // 4 of 6 positive
    const without = batch("o", 6, 1, ["size"]);  // 1 of 6 positive
    const l = learnFromOutcomes([...withIt.ps, ...without.ps], [...withIt.out, ...without.out]);
    expect(l.ready).toBe(true);
    const i = l.insights.find((x) => x.id === "cert")!;
    expect(i).toMatchObject({ withN: 6, withPositive: 4, withoutN: 6, withoutPositive: 1, direction: "more" });
    expect(i.gap).toBe(50);
    expect(i.suggestion).toMatch(/higher weight for “Signal cert”/);
  });

  it("finds one that went with silence, and suggests a lower weight only on a sample of five or more each side", () => {
    const withIt = batch("w", 5, 0, ["noise"]);
    const without = batch("o", 5, 4, ["size"]);
    const l = learnFromOutcomes([...withIt.ps, ...without.ps], [...withIt.out, ...without.out]);
    const i = l.insights.find((x) => x.id === "noise")!;
    expect(i.direction).toBe("less");
    expect(i.suggestion).toMatch(/lower weight/);
    const small = batch("s", 3, 0, ["tiny"]);
    const rest = batch("r", 8, 6, ["size"]);
    const l2 = learnFromOutcomes([...small.ps, ...rest.ps], [...small.out, ...rest.out]);
    expect(l2.insights.find((x) => x.id === "tiny")!.suggestion).toBeNull();
  });

  it("does not report a signal with too few on either side, or a gap that is small", () => {
    const two = batch("t", MIN_GROUP - 1, MIN_GROUP - 1, ["rare"]);
    const many = batch("m", 9, 3, ["size"]);
    expect(learnFromOutcomes([...two.ps, ...many.ps], [...two.out, ...many.out]).insights.find((x) => x.id === "rare")).toBeUndefined();
    const a = batch("a", 5, 2, ["x"]);
    const b = batch("b", 5, 2, ["y"]);
    expect(Math.abs(NOTABLE_GAP)).toBeGreaterThan(0);
    expect(learnFromOutcomes([...a.ps, ...b.ps], [...a.out, ...b.out]).insights).toEqual([]);
  });

  it("puts the biggest gaps first", () => {
    const a = batch("a", 6, 6, ["big"]);
    const b = batch("b", 6, 3, ["mid"]);
    const c = batch("c", 6, 0, ["none"]);
    const l = learnFromOutcomes([...a.ps, ...b.ps, ...c.ps], [...a.out, ...b.out, ...c.out]);
    expect(l.insights[0]!.id).toBe("big");
    expect(l.insights.map((x) => Math.abs(x.gap))).toEqual([...l.insights.map((x) => Math.abs(x.gap))].sort((x, y) => y - x));
  });

  it("asks whether a score at or above the bar really did better than one below it", () => {
    const high = batch("h", 5, 4, ["a"], 80);
    const low = batch("l", 5, 1, ["b"], 50);
    const l = learnFromOutcomes([...high.ps, ...low.ps], [...high.out, ...low.out]);
    expect(l.scoreSplit).toEqual({ highN: 5, highPositive: 4, lowN: 5, lowPositive: 1, gap: 60 });
    const onlyHigh = batch("x", 11, 5, ["a"], 90);
    expect(learnFromOutcomes(onlyHigh.ps, onlyHigh.out).scoreSplit).toBeNull();
  });

  it("writes a rate with the sample beside it", () => {
    expect(rateText(2, 5)).toBe("40% (2 of 5)");
    expect(rateText(0, 0)).toBe("no companies");
  });
});

describe("the learning data, from the demo world", () => {
  it("reads every company's score with its rubric parts, and the whole outcome history", async () => {
    const { getDemo } = await import("@/lib/demo/world");
    const { pgPort } = await import("@/lib/db/pg-port");
    const { learningData } = await import("@/lib/app/queries");
    const w = await getDemo();
    const op = pgPort(w.db.as(w.users.operator));
    const [a] = await w.db.admin<{ id: string }>("select id from public.prospects where domain = 'northwind.io' order by created_at limit 1");
    await op.rpc("log_outcome", { p_prospect: a!.id, p_status: "reached_out", p_note: "", p_follow_up: null, p_do_not_contact: false });
    await op.rpc("log_outcome", { p_prospect: a!.id, p_status: "replied", p_note: "", p_follow_up: null, p_do_not_contact: false });
    const d = await learningData(op);
    const nw = d.prospects.find((x) => x.id === a!.id)!;
    expect(nw.score).toBeGreaterThan(50);
    expect(nw.parts.length).toBeGreaterThan(3);
    expect(nw.parts.every((x) => typeof x.id === "string" && typeof x.points === "number")).toBe(true);
    expect(d.outcomes.filter((o) => o.prospect_id === a!.id).map((o) => o.status)).toEqual(["reached_out", "replied"]);
    const l = learnFromOutcomes(d.prospects, d.outcomes);
    expect(l.funnel).toMatchObject({ reached: 1, replied: 1, positive: 1 });
    expect(l.ready).toBe(false);
  }, 60_000);
});
