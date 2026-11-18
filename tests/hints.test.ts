import { describe, expect, it } from "vitest";
import { TokenBudget } from "@/lib/ai/budget";
import { scriptedAi, type JsonStep } from "@/lib/ai/fake";
import { qualify } from "@/lib/agent/loop";
import { applyHints, parseHintInput, readHints } from "@/lib/icp/hints";
import { scoreIcp } from "@/lib/icp/score";
import { emptyFacts, type Facts } from "@/lib/icp/types";
import { createSite } from "@/lib/scrape/site";
import { fakeWeb, page } from "./fakeweb";

const CTX = { excludedDomain: false, suppressed: false, textChars: 5000, pages: 4 };
const withSize = (value: string | null, confidence: "high" | "medium" | "low" = "high", quotes: string[] = ["We are 120 people"]): Facts => ({ ...emptyFacts(), headcount: { value: value as never, confidence, quotes } });
const sizePart = (f: Facts) => scoreIcp(f, CTX).parts.find((p) => p.id === "size")!;

describe("reading and applying hints", () => {
  it("reads a stored size band, ignores anything it does not understand", () => {
    expect(readHints([{ kind: "headcount", value: "51-200" }])).toEqual({ headcount: "51-200" });
    expect(readHints([{ kind: "headcount", value: "huge" }, { kind: "revenue", value: "1m" }])).toEqual({});
    expect(readHints([])).toEqual({});
  });

  it("fills in a size the site did not state, as Hunter's, at medium confidence, with no invented quote", () => {
    const r = applyHints(emptyFacts(), { headcount: "51-200" });
    expect(r.facts.headcount).toEqual({ value: "51-200", confidence: "medium", quotes: [], source: "hunter_discover" });
    expect(r.applied).toEqual([{ kind: "headcount", value: "51-200", source: "hunter_discover", used: true }]);
  });

  it("also fills in a size the model was not sure of (low confidence), since that counts as unknown", () => {
    const r = applyHints(withSize("11-50", "low", []), { headcount: "201-500" });
    expect(r.facts.headcount.value).toBe("201-500");
    expect(r.facts.headcount.source).toBe("hunter_discover");
  });

  it("never overrides a size the site states, and says it was left unused", () => {
    const f = withSize("11-50", "high");
    const r = applyHints(f, { headcount: "501-1000" });
    expect(r.facts).toBe(f);
    expect(r.facts.headcount.value).toBe("11-50");
    expect(r.applied).toEqual([{ kind: "headcount", value: "501-1000", source: "hunter_discover", used: false }]);
    expect(applyHints(withSize("11-50", "medium"), { headcount: "501-1000" }).facts.headcount.value).toBe("11-50");
  });

  it("does nothing without a hint", () => {
    const f = emptyFacts();
    expect(applyHints(f, {})).toEqual({ facts: f, applied: [] });
  });

  it("does not change the facts it was given", () => {
    const f = emptyFacts();
    applyHints(f, { headcount: "51-200" });
    expect(f.headcount.value).toBeNull();
  });
});

describe("what the score does with a size from Hunter", () => {
  it("scores it exactly as the same size from the site would, and says in the label that it came from Hunter", () => {
    const hunter = sizePart(applyHints(emptyFacts(), { headcount: "51-200" }).facts);
    const site = sizePart(withSize("51-200"));
    expect(hunter.points).toBe(site.points);
    expect(hunter.points).toBeGreaterThan(0);
    expect(hunter.label).toBe("Company size (51-200 per Hunter, not stated on the site)");
    expect(site.label).toBe("Company size");
    expect(hunter.quotes).toEqual([]);
  });

  it("flags it as coming from Hunter, and no longer calls the size unknown", () => {
    const s = scoreIcp(applyHints(emptyFacts(), { headcount: "51-200" }).facts, CTX);
    expect(s.flags).toContain("Company size comes from Hunter, not the company's site");
    expect(s.flags).not.toContain("Company size is unknown");
    expect(s.missing).not.toContain("headcount");
    const plain = scoreIcp(emptyFacts(), CTX);
    expect(plain.flags).toContain("Company size is unknown");
    expect(plain.missing).toContain("headcount");
  });

  it("keeps the ordinary estimate flag for a medium size the site gave", () => {
    expect(scoreIcp(withSize("51-200", "medium"), CTX).flags).toContain("Company size is an estimate");
  });
});

describe("hints posted with a Discover run", () => {
  it("keeps a band for a domain that is in the run, and drops the rest", () => {
    const out = parseHintInput({ "a.com": "51-200", "b.com": "11-50", "z.com": "11-50", "c.com": "huge", "d.com": 7 }, ["a.com", "b.com", "c.com", "d.com"]);
    expect(out).toEqual([{ domain: "a.com", kind: "headcount", value: "51-200" }, { domain: "b.com", kind: "headcount", value: "11-50" }]);
  });

  it("copes with anything that is not a map", () => {
    for (const bad of [null, undefined, "x", 3, [], [["a.com", "51-200"]]]) expect(parseHintInput(bad, ["a.com"])).toEqual([]);
  });
});

describe("qualify with a hint", () => {
  const PAD = "Acme builds cloud tooling for engineering teams everywhere. ".repeat(12);
  const SITE = {
    "https://acme.com/robots.txt": { type: "text/plain", body: "" },
    "https://acme.com/": page(`<html><head><title>Acme</title></head><body><main><h1>Acme</h1><p>${PAD}</p><a href="/about">About</a></main></body></html>`),
    "https://acme.com/about": page(`<html><head><title>About</title></head><body><main><h1>About</h1><p>We make cloud tooling and we like it.</p></main></body></html>`),
  };
  const answer = (o: Partial<Record<keyof Facts, [unknown, "high" | "medium" | "low", string[]]>>): JsonStep => {
    const out = structuredClone(emptyFacts()) as unknown as Record<string, { value: unknown; confidence: string; quotes: string[] }>;
    for (const [k, [value, confidence, quotes]] of Object.entries(o)) out[k] = { value, confidence, quotes };
    return { data: out };
  };
  const Q = ["Acme builds cloud tooling"];
  type Read = [unknown, "high" | "medium" | "low", string[]];
  const reads: Partial<Record<keyof Facts, Read>> = { product: ["saas", "high", Q], enterprisePlan: [true, "medium", Q], compliance: ["soc2_type2", "high", Q], securityHiring: ["it_head", "medium", Q] };

  async function run(json: JsonStep[], hints?: { headcount?: "51-200" }, turns: Parameters<typeof scriptedAi>[0] extends infer O ? (O extends { turns?: infer T } ? T : never) : never = []) {
    const web = fakeWeb(SITE as never);
    const site = createSite("acme.com", web.deps);
    await site.fetchUrl("https://acme.com/");
    const ai = scriptedAi({ json, turns });
    const r = await qualify({ ai, site, budget: new TokenBudget(60_000), context: { excludedDomain: false, suppressed: false }, hints });
    return { r, ai };
  }

  it("stops looking for a size it already has, so it saves the model's tokens, and scores it", async () => {
    const withHint = await run([answer(reads)], { headcount: "51-200" });
    expect(withHint.r.rounds).toBe(0);
    expect(withHint.r.stoppedBecause).toBe("enough");
    expect(withHint.ai.turnRequests).toHaveLength(0);
    expect(withHint.r.score.parts.find((p) => p.id === "size")!.points).toBeGreaterThan(0);
    expect(withHint.r.hints).toEqual([{ kind: "headcount", value: "51-200", source: "hunter_discover", used: true }]);
  });

  it("without the hint, the same read has size unknown and goes looking for it", async () => {
    const without = await run([answer(reads), answer(reads)]);
    expect(without.r.facts.headcount.value).toBeNull();
    expect(without.r.score.parts.find((p) => p.id === "size")!.points).toBe(0);
    expect(without.r.hints).toEqual([]);
  });

  it("keeps the hint after the loop fetches another page and reads again, which would otherwise start from a blank size", async () => {
    const thin: Partial<Record<keyof Facts, Read>> = { product: ["saas", "high", Q] };
    const { r } = await run([answer(thin), answer(thin)], { headcount: "51-200" }, [{ calls: [{ name: "fetch_page", args: { path: "/about" } }] }, { calls: [{ name: "stop", args: { reason: "done" } }] }]);
    expect(r.passes.length).toBe(2);
    expect(r.facts.headcount).toMatchObject({ value: "51-200", source: "hunter_discover" });
    expect(r.passes.at(-1)!.facts.headcount.source).toBe("hunter_discover");
    expect(r.hints).toEqual([{ kind: "headcount", value: "51-200", source: "hunter_discover", used: true }]);
  });

  it("stores, as the final read, the facts the score was computed from, so a replay reaches the same verdict", async () => {
    const { r } = await run([answer(reads)], { headcount: "51-200" });
    const stored = r.passes.at(-1)!.facts;
    expect(stored.headcount).toEqual({ value: "51-200", confidence: "medium", quotes: [], source: "hunter_discover" });
    expect(scoreIcp(stored, { excludedDomain: false, suppressed: false, textChars: r.score.parts.length ? 5000 : 0, pages: 4 }).score).toBe(scoreIcp(r.facts, { excludedDomain: false, suppressed: false, textChars: 5000, pages: 4 }).score);
  });

  it("uses the size the site states, and records that the hint was not used", async () => {
    const stated = answer({ ...reads, headcount: ["11-50", "high", Q] });
    const { r } = await run([stated], { headcount: "51-200" });
    expect(r.facts.headcount.value).toBe("11-50");
    expect(r.facts.headcount.source).toBeUndefined();
    expect(r.hints).toEqual([{ kind: "headcount", value: "51-200", source: "hunter_discover", used: false }]);
  });
});
