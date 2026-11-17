import { describe, expect, it } from "vitest";
import { GOLDEN } from "@/lib/quality/golden";
import { expectedVerdict, goldenOracle, runCase, runGolden, summarise, THRESHOLDS, type CaseResult } from "@/lib/quality/harness";

const byId = (id: string) => GOLDEN.find((c) => c.id === id)!;
const textOf = (c: (typeof GOLDEN)[number]) => c.pages.map((p) => p.text).join("\n");

describe("the golden fixtures", () => {
  it("has unique ids and domains, and every page belongs to its company", () => {
    expect(new Set(GOLDEN.map((c) => c.id)).size).toBe(GOLDEN.length);
    expect(new Set(GOLDEN.map((c) => c.domain)).size).toBe(GOLDEN.length);
    for (const c of GOLDEN) for (const p of c.pages) expect(p.url).toContain(c.domain);
  });

  it("quotes every stated fact verbatim from its own pages", () => {
    for (const c of GOLDEN) {
      for (const [k, q] of Object.entries(c.evidence)) {
        expect(textOf(c), `${c.id}.${k}`).toContain(q as string);
      }
    }
  });

  it("gives every stated fact a quote, except an absence", () => {
    const absences = new Set(["none", "none_visible"]);
    for (const c of GOLDEN) {
      for (const [k, v] of Object.entries(c.truth)) {
        if (typeof v === "string" && absences.has(v)) continue;
        if (v === false) continue;
        expect(c.evidence, `${c.id}.${k}`).toHaveProperty(k);
      }
    }
  });

  it("covers the hard cases", () => {
    const tests = GOLDEN.map((c) => c.id);
    for (const id of ["strong-saas", "already-certified", "not-yet-certified", "consumer-app", "agency", "number-trap", "injection", "thin-page", "competitor-badge"]) expect(tests).toContain(id);
    expect(GOLDEN.filter((c) => c.injection)).toHaveLength(1);
  });

  it("scores to the verdicts a person would expect", () => {
    expect(expectedVerdict(byId("strong-saas"))).toBe("qualified");
    expect(expectedVerdict(byId("already-certified"))).toBe("not_fit");
    expect(expectedVerdict(byId("consumer-app"))).toBe("not_fit");
    expect(expectedVerdict(byId("agency"))).toBe("not_fit");
    expect(expectedVerdict(byId("thin-page"))).toBe("needs_more");
  });
});

describe("a model that reads the fixtures correctly", () => {
  it("scores perfectly, and every case matches", async () => {
    const run = await runGolden({ ai: goldenOracle() });
    expect(run.results).toHaveLength(GOLDEN.length);
    for (const r of run.results) {
      expect(r.mismatches, r.id).toEqual([]);
      expect(r.verdict.match, r.id).toBe(true);
      expect(r.error, r.id).toBeNull();
    }
    expect(run.summary).toMatchObject({ accuracy: 1, wrongRate: 0, spurious: 0, verdictAgreement: 1, errors: 0, status: "pass", reasons: [] });
    expect(run.summary.tokens).toBeGreaterThan(0);
    expect(run.summary.injectionsCaught).toEqual({ caught: 1, of: 1 });
  });

  it("flags the planted instruction, and only that one", async () => {
    const run = await runGolden({ ai: goldenOracle() });
    for (const r of run.results) expect(r.injection.flagged, r.id).toBe(r.injection.expected);
  });
});

describe("a model that has got worse is noticed", () => {
  const run = (d: Parameters<typeof goldenOracle>[1]) => runGolden({ ai: goldenOracle(GOLDEN, d) });

  it("fails when it reads facts wrongly", async () => {
    const r = await run({ wrong: ["compliance", "headcount", "product", "customerData"] });
    expect(r.summary.status).toBe("fail");
    expect(r.summary.wrongRate).toBeGreaterThan(THRESHOLDS.wrongRate.fail);
    expect(r.results.some((x) => x.mismatches.some((m) => m.outcome === "wrong"))).toBe(true);
  });

  it("fails when it says nothing about the important facts, and says how many it missed", async () => {
    const r = await run({ drop: ["compliance", "headcount", "product", "customerData", "enterprisePlan", "securityHiring"] });
    expect(r.summary.status).toBe("fail");
    expect(r.summary.accuracy).toBeLessThan(THRESHOLDS.accuracy.fail);
    expect(r.results.flatMap((x) => x.mismatches).every((m) => m.outcome === "missed")).toBe(true);
  });

  it("counts a fact asserted where no page states it", async () => {
    const r = await run({ invent: { sellsEu: true } });
    expect(r.summary.spurious).toBeGreaterThan(0);
    expect(r.results.flatMap((x) => x.mismatches).some((m) => m.outcome === "spurious" && m.key === "sellsEu")).toBe(true);
  });

  it("catches a model that obeys the instruction hidden in a page", async () => {
    const r = await run({ obey: true });
    const c = r.results.find((x) => x.id === "injection")!;
    expect(c.mismatches.some((m) => m.key === "headcount")).toBe(true);
  });

  it("notices when the verdict changes because facts went missing", async () => {
    const r = await run({ drop: ["headcount", "compliance", "product", "customerData", "enterpriseSecurity", "enterprisePlan"] });
    expect(r.summary.verdictAgreement).toBeLessThan(1);
    expect(r.results.some((x) => !x.verdict.match && x.verdict.got !== null)).toBe(true);
  });

  it("treats a low-confidence answer as unknown, the way the scorer does", async () => {
    const base = goldenOracle();
    const hedging = { ...base, generateJson: async (req: never) => {
      const res = await base.generateJson(req);
      for (const v of Object.values(res.data as Record<string, { confidence: string }>)) v.confidence = "low";
      return res;
    } };
    const c = await runCase(byId("strong-saas"), hedging as never);
    // Only a code-checked absence survives a hedge; every stated fact falls back to unknown.
    expect(c.correct).toBeLessThanOrEqual(1);
    expect(c.missed).toBeGreaterThanOrEqual(c.asserted - 1);
  });

  it("fails the whole set when a single case cannot be read, however good the rest", async () => {
    const good = await runGolden({ ai: goldenOracle() });
    const cases = [...good.results];
    cases[0] = { ...cases[0]!, error: "quota" };
    expect(summarise(cases).status).toBe("fail");
  });

  it("marks a case the model cannot read as an error, with every fact missed", async () => {
    const broken = { ...goldenOracle(), generateJson: async () => { throw new Error("quota"); } };
    const c = await runCase(byId("strong-saas"), broken as never);
    expect(c.error).toBeTruthy();
    expect(c.missed).toBe(c.asserted);
    expect(summarise([c]).status).toBe("fail");
  });
});

describe("summarise", () => {
  const ok = (over: Partial<CaseResult> = {}): CaseResult => ({ id: "x", tests: "", mismatches: [], asserted: 10, correct: 10, missed: 0, wrong: 0, spurious: 0, groundingFailures: 0, injection: { expected: false, flagged: false }, verdict: { expected: "qualified", got: "qualified", match: true }, tokens: 100, model: "m", error: null, ...over });

  it("passes with nothing to report", () => expect(summarise([ok()]).status).toBe("pass"));
  it("warns between the two lines and fails below the lower one", () => {
    expect(summarise([ok({ correct: 8, missed: 2 })]).status).toBe("warn");
    expect(summarise([ok({ correct: 6, missed: 4 })]).status).toBe("fail");
  });
  it("warns when a planted instruction is not flagged", () => {
    const s = summarise([ok({ injection: { expected: true, flagged: false } })]);
    expect(s.status).toBe("warn");
    expect(s.reasons.join(" ")).toMatch(/injection/i);
  });
  it("never lets a warning hide a failure", () => {
    expect(summarise([ok({ injection: { expected: true, flagged: false }, correct: 5, missed: 5 })]).status).toBe("fail");
  });
  it("does not pass an empty set by dividing by zero", () => {
    const s = summarise([]);
    expect(Number.isFinite(s.accuracy)).toBe(true);
    expect(s.cases).toBe(0);
  });
});
