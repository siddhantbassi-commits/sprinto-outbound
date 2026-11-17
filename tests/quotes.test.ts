import { describe, expect, it } from "vitest";
import { buildCorpus, groundFacts, normaliseText, quoteInCorpus } from "@/lib/extract/quotes";
import { emptyFacts } from "@/lib/icp/types";
import { fact } from "./helpers";

const pages = ["Acme launched an Enterprise plan with SSO.\n\nWe are SOC 2 Type II “in progress”.", "Join us: Head of Security (Remote)"];
const corpus = buildCorpus(pages);

describe("quoteInCorpus", () => {
  it("accepts a verbatim quote", () => expect(quoteInCorpus("Enterprise plan with SSO", corpus)).toBe(true));
  it("ignores case, whitespace and curly quotes", () => {
    expect(quoteInCorpus("we are soc 2 type ii \"in progress\"", corpus)).toBe(true);
    expect(quoteInCorpus("launched   an Enterprise\nplan", corpus)).toBe(true);
  });
  it("rejects an invented quote", () => expect(quoteInCorpus("Acme raised a $50M Series B", corpus)).toBe(false));
  it("rejects a quote stitched from two separate places", () => expect(quoteInCorpus("with SSO. Join us", corpus)).toBe(false));
  it("rejects a quote that is too short to prove anything", () => expect(quoteInCorpus("SSO", corpus)).toBe(false));
  it("normalises dashes", () => expect(normaliseText("a — b")).toBe("a - b"));
});

describe("groundFacts", () => {
  it("keeps supported facts and drops unsupported ones", () => {
    const facts = {
      ...emptyFacts(),
      enterprisePlan: fact(true, "Enterprise plan with SSO"),
      securityHiring: fact("security_role" as const, "Head of Security (Remote)"),
      sellsEu: fact(true, "We are headquartered in Berlin"), // invented
    };
    const r = groundFacts(facts, corpus);
    expect(r.facts.enterprisePlan.value).toBe(true);
    expect(r.facts.securityHiring.value).toBe("security_role");
    expect(r.facts.sellsEu).toEqual({ value: null, confidence: "low", quotes: [] });
    expect(r.failures).toEqual(["sellsEu"]);
    expect(r.checked).toBe(3);
  });

  it("drops only the unverifiable quotes of a fact that has one good quote", () => {
    const f = { ...emptyFacts(), enterprisePlan: { value: true, confidence: "high" as const, quotes: ["Enterprise plan with SSO", "made up claim here"] } };
    const r = groundFacts(f, corpus);
    expect(r.facts.enterprisePlan.quotes).toEqual(["Enterprise plan with SSO"]);
    expect(r.failures).toEqual([]);
  });

  it("treats a fact with a value but no quotes as unsupported", () => {
    const r = groundFacts({ ...emptyFacts(), headcount: { value: "51-200", confidence: "high", quotes: [] } }, corpus);
    expect(r.facts.headcount.value).toBeNull();
    expect(r.failures).toEqual(["headcount"]);
  });

  it("does not mutate its input", () => {
    const facts = { ...emptyFacts(), sellsEu: fact(true, "invented sentence here") };
    groundFacts(facts, corpus);
    expect(facts.sellsEu.value).toBe(true);
  });
});
