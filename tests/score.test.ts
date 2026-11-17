import { describe, expect, it } from "vitest";
import { ICP_V1 } from "@/lib/icp/config";
import { coverage, scoreIcp } from "@/lib/icp/score";
import { emptyFacts, type Facts } from "@/lib/icp/types";
import { CTX, fact, strongFacts } from "./helpers";

const withFacts = (patch: Partial<Facts>): Facts => ({ ...strongFacts(), ...patch });

describe("scoreIcp: verdicts", () => {
  it("qualifies a strong fit, with every point traceable to a quote", () => {
    const r = scoreIcp(strongFacts(), CTX);
    expect(r.verdict).toBe("qualified");
    // fit 15+15+10, need 25+3+7, timing 8+7+0
    expect(r.score).toBe(90);
    expect(r.parts.filter((p) => p.points > 0).every((p) => p.quotes.length > 0)).toBe(true);
    expect(r.icpVersion).toBe(1);
  });

  it("sums to 100 at the maximum of every part", () => {
    const max = ICP_V1.points;
    const total = max.customerData.stated + 15 + 10 + 25 + max.gap.cap + 7 + 8 + 7 + 5;
    expect(total).toBe(100);
  });

  it("puts a middling company in maybe", () => {
    const r = scoreIcp(
      withFacts({ compliance: fact("soc2_type1"), enterprisePlan: fact(false), enterpriseLogos: fact(true), enterpriseSecurity: fact(false), securityHiring: fact("none"), recentLaunchOrFunding: fact(false), securityFriction: fact(false), sellsEu: fact(false) }),
      CTX,
    );
    // 15 + 5 + 10 + 15 = 45
    expect(r.score).toBe(45);
    expect(r.verdict).toBe("maybe");
  });

  it("calls a weak company not a fit", () => {
    const r = scoreIcp(
      withFacts({ compliance: fact("soc2_iso"), enterprisePlan: fact(false), enterpriseLogos: fact(false), enterpriseSecurity: fact(false), securityHiring: fact("none"), recentLaunchOrFunding: fact(false), securityFriction: fact(false), sellsEu: fact(false), customerData: fact("implied") }),
      CTX,
    );
    expect(r.verdict).toBe("not_fit");
    expect(r.reason).toMatch(/below 45/);
  });

  it("is exactly on the thresholds at 65 and 45", () => {
    const at = (qualifyAt: number) => scoreIcp(strongFacts(), CTX, { ...ICP_V1, qualifyAt }).verdict;
    expect(at(90)).toBe("qualified");
    expect(at(91)).toBe("maybe");
    const maybeAt = (m: number) => scoreIcp(strongFacts(), CTX, { ...ICP_V1, qualifyAt: 200, maybeAt: m }).verdict;
    expect(maybeAt(90)).toBe("maybe");
    expect(maybeAt(91)).toBe("not_fit");
  });

  it("applies the competitor penalty and never goes below zero", () => {
    const r = scoreIcp(withFacts({ complianceVendor: fact("competitor") }), CTX);
    expect(r.score).toBe(75);
    const low = scoreIcp(withFacts({ complianceVendor: fact("competitor"), compliance: fact("soc2_iso"), customerData: fact("none"), enterprisePlan: fact(false), enterpriseLogos: fact(false), enterpriseSecurity: fact(false), headcount: fact("501-1000"), securityHiring: fact("none"), recentLaunchOrFunding: fact(false), securityFriction: fact(false), sellsEu: fact(false) }), CTX);
    expect(low.score).toBe(0);
  });

  it("is deterministic", () => {
    expect(scoreIcp(strongFacts(), CTX)).toEqual(scoreIcp(structuredClone(strongFacts()), CTX));
  });
});

describe("scoreIcp: gates", () => {
  it.each([
    ["a consumer product", { product: fact("consumer") }],
    ["an agency", { product: fact("agency") }],
    ["a consumer audience", { audience: fact("consumer") }],
    ["over 1,000 people", { headcount: fact("1000+") }],
    ["an existing Sprinto customer", { complianceVendor: fact("sprinto") }],
  ] as const)("fails for %s", (_name, patch) => {
    const r = scoreIcp(withFacts(patch as Partial<Facts>), CTX);
    expect(r.verdict).toBe("not_fit");
    expect(r.score).toBe(0);
  });

  it("fails an excluded or suppressed domain", () => {
    expect(scoreIcp(strongFacts(), { ...CTX, excludedDomain: true }).verdict).toBe("not_fit");
    expect(scoreIcp(strongFacts(), { ...CTX, suppressed: true }).reason).toMatch(/suppress/i);
  });

  it("says needs more, not not-a-fit, when there is too little text", () => {
    const r = scoreIcp(strongFacts(), { ...CTX, textChars: 200 });
    expect(r.verdict).toBe("needs_more");
    expect(r.reason).toMatch(/Enough to judge/);
    expect(scoreIcp(strongFacts(), { ...CTX, pages: 1 }).verdict).toBe("needs_more");
  });

  it("says needs more, naming what is missing, when key facts are unknown", () => {
    const r = scoreIcp(withFacts({ compliance: { value: null, confidence: "low", quotes: [] }, securityHiring: { value: null, confidence: "low", quotes: [] } }), CTX);
    expect(r.verdict).toBe("needs_more");
    expect(r.missing).toEqual(["compliance", "securityHiring"]);
  });

  it("does not guess from a low-confidence reading", () => {
    const r = scoreIcp(withFacts({ compliance: fact("none_visible", "x quote here", "low") }), CTX);
    expect(r.missing).toContain("compliance");
    expect(r.parts.find((p) => p.id === "status")?.points).toBe(0);
  });

  it("an unknown product cannot be a fit", () => {
    const r = scoreIcp({ ...strongFacts(), product: emptyFacts().product }, CTX);
    expect(r.verdict).toBe("needs_more");
  });

  it("flags an unknown size without failing it", () => {
    const r = scoreIcp(withFacts({ headcount: emptyFacts().headcount }), CTX);
    expect(r.flags).toContain("Company size is unknown");
    expect(r.gates.find((g) => g.id === "G4")?.status).toBe("pass");
  });
});

describe("scoreIcp: monotonic", () => {
  it("adding a positive signal never lowers the score", () => {
    const base = withFacts({ securityHiring: fact("none"), recentLaunchOrFunding: fact(false), securityFriction: fact(false), enterpriseSecurity: fact(false) });
    const baseScore = scoreIcp(base, CTX).score;
    for (const better of [
      { securityHiring: fact("security_role") }, { recentLaunchOrFunding: fact(true) }, { securityFriction: fact(true) },
      { enterpriseSecurity: fact(true) }, { newRegulatedMarket: fact(true) }, { healthData: fact(true), hipaaStated: fact(false) },
    ] as Partial<Facts>[]) {
      expect(scoreIcp({ ...base, ...better }, CTX).score).toBeGreaterThanOrEqual(baseScore);
    }
  });

  it("caps the framework-gap points", () => {
    const r = scoreIcp(withFacts({ sellsEu: fact(true), gdprStated: fact(false), healthData: fact(true), hipaaStated: fact(false), payments: fact(true), pciStated: fact(false) }), CTX);
    expect(r.parts.find((p) => p.id === "gap")?.points).toBe(8);
  });

  it("a stated framework removes that gap", () => {
    const r = scoreIcp(withFacts({ sellsEu: fact(true), gdprStated: fact(true) }), CTX);
    expect(r.parts.find((p) => p.id === "gap")?.points).toBe(0);
  });
});

describe("coverage", () => {
  it("counts the six key facts", () => {
    expect(coverage(strongFacts())).toMatchObject({ known: 6, missing: [], enough: true });
    expect(coverage(emptyFacts())).toMatchObject({ known: 0, enough: false });
  });
  it("counts enterprise as known if any one of its three signals is known", () => {
    const f = { ...emptyFacts(), enterpriseLogos: fact(false) };
    expect(coverage(f).missing).not.toContain("enterprise");
  });
});
