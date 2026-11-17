import { describe, expect, it } from "vitest";
import { ICP_V1, type IcpConfig } from "@/lib/icp/config";
import { configToValues, describeRubric, diffConfig, FIELDS, maxPoints, parseConfigForm } from "@/lib/icp/edit";
import { replay, type Side, type Subject } from "@/lib/icp/replay";
import { scoreIcp } from "@/lib/icp/score";
import { emptyFacts, type Facts } from "@/lib/icp/types";
import { fact, strongFacts } from "./helpers";

const cfg = (mut: (c: IcpConfig) => void = () => undefined): IcpConfig => {
  const c = structuredClone(ICP_V1);
  mut(c);
  return c;
};
const side = (c: IcpConfig = ICP_V1, blocklist: string[] = []): Side => ({ config: c, blocklist });

/** A subject whose stored verdict is exactly what the base config gave it, so the replay's self-check passes. */
function subject(domain: string, facts: Facts, over: Partial<Subject> = {}, base: IcpConfig = ICP_V1): Subject {
  const r = scoreIcp(facts, { excludedDomain: false, suppressed: false, textChars: 5000, pages: 4 }, base);
  return { id: `id-${domain}`, domain, stored: { verdict: r.verdict, score: Math.round(r.score) }, facts, textChars: 5000, pages: 4, suppressed: false, ...over };
}

/** About 57: a maybe under v1. */
const maybeFacts = (): Facts => ({ ...emptyFacts(), product: fact("saas"), audience: fact("business"), customerData: fact("stated"), headcount: fact("51-200"), enterprisePlan: fact(true), compliance: fact("soc2_type1"), complianceVendor: fact("none"), securityHiring: fact("none") });
const weakFacts = (): Facts => ({ ...emptyFacts(), product: fact("saas"), audience: fact("business"), customerData: fact("stated"), headcount: fact("1-10"), enterprisePlan: fact(false), compliance: fact("soc2_type2"), complianceVendor: fact("none"), securityHiring: fact("none") });

describe("replay: the self-check and the unchanged case", () => {
  it("moves nobody when the draft is the base, and reproduces every stored verdict", () => {
    const r = replay([subject("a.com", strongFacts()), subject("b.com", maybeFacts()), subject("c.com", weakFacts())], side(), side());
    expect(r.movers).toEqual([]);
    expect(r.unchanged).toBe(3);
    expect(r.reproduces).toEqual({ matching: 3, of: 3, olderVersion: 0, other: 0 });
    expect(r.scoreOnly).toBe(0);
  });

  it("counts a stored verdict that the current version no longer reproduces, so the comparison is not trusted blindly", () => {
    const wrong = subject("a.com", strongFacts(), { stored: { verdict: "not_fit", score: 0 } });
    const r = replay([wrong, subject("b.com", maybeFacts())], side(), side());
    expect(r.reproduces).toEqual({ matching: 1, of: 2, olderVersion: 0, other: 1 });
  });

  it("tells a verdict scored under an older ICP version apart from one that differs for another reason", () => {
    const older = subject("old.com", strongFacts(), { stored: { verdict: "maybe", score: 55, version: 1 } });
    const same = subject("other.com", strongFacts(), { stored: { verdict: "maybe", score: 55, version: 2 } });
    const unknown = subject("none.com", strongFacts(), { stored: { verdict: "maybe", score: 55, version: null } });
    const base = side(cfg((c) => (c.version = 2)));
    expect(replay([older, same, unknown], base, base).reproduces).toEqual({ matching: 0, of: 3, olderVersion: 1, other: 2 });
  });

  it("handles an empty store", () => {
    const r = replay([], side(), side(cfg((c) => (c.qualifyAt = 80))));
    expect(r).toMatchObject({ total: 0, movers: [], unchanged: 0, reproduces: { matching: 0, of: 0, olderVersion: 0, other: 0 } });
  });
});

describe("replay: thresholds", () => {
  it("shows a maybe that now qualifies, with the new reason", () => {
    const [s] = [subject("harbor.com", maybeFacts())];
    expect(s!.stored.verdict).toBe("maybe");
    const r = replay([s!], side(), side(cfg((c) => (c.qualifyAt = s!.stored.score as number))));
    expect(r.movers).toHaveLength(1);
    expect(r.movers[0]).toMatchObject({ domain: "harbor.com", kind: "now_qualifies", from: { verdict: "maybe" }, to: { verdict: "qualified" } });
    expect(r.movers[0]!.reason).toMatch(/at or above/);
    expect(r.matrix.maybe!.qualified).toBe(1);
    expect(r.counts.base.maybe).toBe(1);
    expect(r.counts.draft.qualified).toBe(1);
  });

  it("shows a qualified company that no longer qualifies under a stricter bar", () => {
    const r = replay([subject("a.com", strongFacts())], side(), side(cfg((c) => (c.qualifyAt = 95))));
    expect(r.movers[0]).toMatchObject({ kind: "no_longer_qualifies", from: { verdict: "qualified" }, to: { verdict: "maybe" } });
  });

  it("counts a changed score with the same verdict separately from a move", () => {
    const r = replay([subject("a.com", strongFacts())], side(), side(cfg((c) => (c.points.size["51-200"] = 5))));
    expect(r.movers).toEqual([]);
    expect(r.scoreOnly).toBe(1);
    expect(r.unchanged).toBe(0);
  });
});

describe("replay: weights and the reason for a move", () => {
  it("names the parts that changed most, biggest first, at most three", () => {
    const draft = cfg((c) => {
      c.points.size["51-200"] = 0;
      c.points.status.in_progress = 5;
      c.points.hiring.security_role = 0;
      c.points.timing.recent = 0;
    });
    const r = replay([subject("a.com", strongFacts())], side(), side(draft));
    const because = r.movers[0]?.because ?? [];
    expect(because.length).toBeLessThanOrEqual(3);
    expect(because[0]).toMatchObject({ label: "Compliance status", from: 25, to: 5 });
    for (let i = 1; i < because.length; i += 1) expect(Math.abs(because[i - 1]!.to - because[i - 1]!.from)).toBeGreaterThanOrEqual(Math.abs(because[i]!.to - because[i]!.from));
  });

  it("orders movers: now qualifies, then no longer qualifies, then others, each by domain", () => {
    const subs = [subject("z-strong.com", strongFacts()), subject("a-maybe.com", maybeFacts()), subject("m-strong.com", strongFacts()), subject("b-weak.com", weakFacts())];
    const draft = cfg((c) => {
      c.qualifyAt = 58;
      c.maybeAt = 10; // lets the weak one become a maybe
    });
    const r = replay(subs, side(), side(draft));
    expect(r.movers.map((m) => [m.kind, m.domain])).toEqual(r.movers.map((m) => [m.kind, m.domain]).sort(([ka, da], [kb, db]) => ({ now_qualifies: 0, no_longer_qualifies: 1, other: 2 })[ka as "other"] - ({ now_qualifies: 0, no_longer_qualifies: 1, other: 2 })[kb as "other"] || String(da).localeCompare(String(db))));
    expect(r.movers.some((m) => m.domain === "b-weak.com" && m.kind === "other")).toBe(true);
  });
});

describe("replay: the context the model never sees", () => {
  it("applies the draft's blocklist, which can turn a good company into a not-fit", () => {
    const r = replay([subject("customer.io", strongFacts())], side(), side(ICP_V1, ["customer.io"]));
    expect(r.movers[0]).toMatchObject({ from: { verdict: "qualified" }, to: { verdict: "not_fit", score: 0 } });
    expect(r.movers[0]!.reason).toMatch(/blocklist/i);
  });

  it("keeps a suppressed company a not-fit under both", () => {
    const r = replay([subject("a.com", strongFacts(), { suppressed: true })], side(), side(cfg((c) => (c.qualifyAt = 50))));
    expect(r.movers).toEqual([]);
    expect(r.counts.base.not_fit).toBe(1);
  });

  it("applies the draft's reading-enough rule to the characters actually read", () => {
    const thin = subject("thin.com", strongFacts(), { textChars: 800, pages: 4 });
    const r = replay([thin], side(), side(cfg((c) => (c.minChars = 2000))));
    expect(r.movers[0]).toMatchObject({ from: { verdict: "qualified" }, to: { verdict: "needs_more" } });
    expect(r.movers[0]!.reason).toMatch(/characters/);
  });

  it("assumes enough was read, and says how many rows that applied to, when the figures were not recorded", () => {
    const r = replay([subject("old.com", strongFacts(), { textChars: null, pages: null }), subject("new.com", strongFacts())], side(), side());
    expect(r.approximated).toBe(1);
    expect(r.counts.draft.qualified).toBe(2);
  });
});

describe("replay does not change its inputs", () => {
  it("leaves the facts and both configs untouched", () => {
    const s = subject("a.com", strongFacts());
    const before = JSON.stringify(s);
    const draft = cfg((c) => (c.qualifyAt = 70));
    const base = structuredClone(ICP_V1);
    replay([s], side(base), side(draft));
    expect(JSON.stringify(s)).toBe(before);
    expect(base).toEqual(ICP_V1);
    expect(draft.qualifyAt).toBe(70);
  });
});

// ================================================================ editing
describe("parseConfigForm", () => {
  const values = (over: Record<string, string> = {}) => ({ ...Object.fromEntries(Object.entries(configToValues(ICP_V1)).map(([k, v]) => [k, String(v)])), ...over });
  const get = (v: Record<string, string>) => (n: string) => v[n];

  it("round-trips the current config exactly, and does not touch the base", () => {
    const base = structuredClone(ICP_V1);
    const r = parseConfigForm(get(values()), base);
    expect(r).toEqual({ ok: true, config: ICP_V1 });
    expect(base).toEqual(ICP_V1);
  });

  it("applies one changed value to exactly that part of the config", () => {
    const r = parseConfigForm(get(values({ "size.51-200": "14" })), ICP_V1);
    expect(r.ok && diffConfig(ICP_V1, r.config)).toEqual([{ name: "size.51-200", label: "Company size 51-200", from: 10, to: 14 }]);
  });

  it("covers every number in the rubric, so nothing that scores can be missed or edited twice", () => {
    const leaves: string[] = [];
    const walk = (o: unknown, path: string) => {
      if (typeof o === "number") leaves.push(path);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
    };
    walk({ ...ICP_V1, version: undefined }, "");
    expect(leaves.length).toBe(FIELDS.length);
    expect(new Set(FIELDS.map((f) => f.name)).size).toBe(FIELDS.length);
    // Changing any one field changes exactly one number.
    for (const f of FIELDS) {
      const c = structuredClone(ICP_V1);
      f.set(c, f.get(c) === f.max ? f.max - 1 : f.get(c) + 1);
      expect(diffConfig(ICP_V1, c).map((d) => d.name), f.name).toEqual([f.name]);
    }
  });

  it.each([
    ["a blank", { "gap.cap": "" }, /Most the framework gaps.*whole number/],
    ["a decimal", { "gap.cap": "7.5" }, /whole number/],
    ["text", { "gap.cap": "lots" }, /whole number/],
    ["a negative", { "enterprise.plan": "-1" }, /between 0 and 50/],
    ["too big", { "enterprise.plan": "51" }, /between 0 and 50/],
    ["a threshold out of range", { qualifyAt: "101" }, /between 2 and 100/],
    ["no pages needed", { minPages: "0" }, /between 1 and 12/],
  ])("refuses %s, naming the field", (_n, over, message) => {
    const r = parseConfigForm(get(values(over)), ICP_V1);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.errors.join(" ")).toMatch(message);
  });

  it("refuses a 'qualified' bar that is not above the 'maybe' bar", () => {
    const r = parseConfigForm(get(values({ qualifyAt: "50", maybeAt: "50" })), ICP_V1);
    expect(!r.ok && r.errors).toEqual(['"Qualified at" must be higher than "maybe from".']);
  });

  it("lists every problem at once, and returns nothing partial", () => {
    const r = parseConfigForm(get(values({ "gap.cap": "x", "enterprise.plan": "99", minPages: "" })), ICP_V1);
    expect(!r.ok && r.errors).toHaveLength(3);
  });

  it("ignores values that are not fields, so extra form data cannot add anything to the config", () => {
    const r = parseConfigForm(get(values({ "points.evil": "999", __proto__: "x" } as never)), ICP_V1);
    expect(r).toEqual({ ok: true, config: ICP_V1 });
  });
});

describe("maxPoints, describeRubric, diffConfig", () => {
  it("adds the v1 weights up to 100, as the scope says", () => {
    expect(maxPoints(ICP_V1)).toBe(100);
    expect(maxPoints(cfg((c) => (c.points.size["51-200"] = 20)))).toBe(110);
  });

  it("describes the rubric in words with the real numbers, and follows a change", () => {
    const words = (c: IcpConfig) => describeRubric(c).flatMap((d) => d.lines).join("\n");
    expect(words(ICP_V1)).toContain("65 or more: qualified");
    expect(words(ICP_V1)).toContain("51-200: 10");
    expect(words(ICP_V1)).toContain("soc 2 type 2 and iso 27001 both held: 0");
    expect(words(ICP_V1)).toContain("Over 1,000 people: not a fit.");
    expect(words(cfg((c) => (c.qualifyAt = 80)))).toContain("80 or more: qualified");
    expect(describeRubric(ICP_V1).map((d) => d.title)).toEqual(["Who is ruled out first (gates)", "Fit", "Need", "Timing", "Penalty", "The verdict"]);
  });

  it("lists exactly what changed between two versions, and nothing when they match", () => {
    expect(diffConfig(ICP_V1, ICP_V1)).toEqual([]);
    const d = diffConfig(ICP_V1, cfg((c) => { c.qualifyAt = 70; c.points.timing.market = 9; }));
    expect(d.map((x) => [x.name, x.from, x.to])).toEqual([["qualifyAt", 65, 70], ["timing.market", 5, 9]]);
  });
});
