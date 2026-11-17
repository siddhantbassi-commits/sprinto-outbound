import { describe, expect, it } from "vitest";
import { unsupported } from "@/lib/ask/check";
import { createGuard } from "@/lib/ask/limit";

const results = [{ total_matching: 3, companies: [{ domain: "northwind.io", score: 71 }, { domain: "harborpay.com", score: 52 }, { domain: "lumen.health", score: 80 }] }];

describe("unsupported", () => {
  it("accepts an answer built only from the lookups", () => {
    expect(unsupported("northwind.io scored 71 and harborpay.com scored 52. 3 companies matched.", results)).toEqual({ domains: [], numbers: [] });
  });
  it("names a company no lookup returned", () => {
    expect(unsupported("Also check acme.com.", results).domains).toEqual(["acme.com"]);
  });
  it("names a number no lookup contains", () => {
    expect(unsupported("northwind.io scored 94.", results).numbers).toEqual(["94"]);
    expect(unsupported("About 40% qualified.", results).numbers).toEqual(["40"]);
  });
  it("accepts the size of a list as a count, and numbers with commas", () => {
    expect(unsupported("There are 3 here.", results).numbers).toEqual([]);
    expect(unsupported("Used 12,400 tokens.", [{ tokens: 12400 }]).numbers).toEqual([]);
  });
  it("does not treat the digits inside a domain as a separate number", () => {
    expect(unsupported("see web3.io", [{ d: "web3.io" }])).toEqual({ domains: [], numbers: [] });
  });
  it("supports a count with the length of a list, even when the number itself never appears", () => {
    const list = [{ companies: [{ d: "a.com" }, { d: "b.com" }, { d: "c.com" }] }];
    expect(unsupported("There are 3 companies.", list).numbers).toEqual([]);
    expect(unsupported("There are 4 companies.", list).numbers).toEqual(["4"]);
  });
  it("lets 0 and 1 pass as ordinary speech", () => expect(unsupported("Only 1 matched and 0 failed.", [{ a: "x" }]).numbers).toEqual([]));
  it("is case-insensitive for domains", () => expect(unsupported("Northwind.IO", results).domains).toEqual([]));
  it("finds nothing to object to in an answer with no claims", () => expect(unsupported("I could not find that.", results)).toEqual({ domains: [], numbers: [] }));
});

describe("createGuard", () => {
  it("allows a few questions per window, then says when to try again", () => {
    let t = 0;
    const g = createGuard({ max: 2, windowMs: 600_000, now: () => t });
    for (let i = 0; i < 2; i++) {
      const e = g.enter("u");
      expect(e.ok).toBe(true);
      if (e.ok) e.release();
      t += 1000;
    }
    const third = g.enter("u");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toMatch(/2 questions in 10 minutes/);
    t += 600_000;
    expect(g.enter("u").ok).toBe(true);
  });
  it("allows one question at a time per person, but not across people", () => {
    const g = createGuard({ max: 5, windowMs: 60_000 });
    const a = g.enter("a");
    expect(g.enter("a").ok).toBe(false);
    expect(g.enter("b").ok).toBe(true);
    if (a.ok) a.release();
    expect(g.enter("a").ok).toBe(true);
  });
  it("releasing twice does not free someone else's slot", () => {
    const g = createGuard({ max: 5, windowMs: 60_000 });
    const a = g.enter("a");
    if (!a.ok) throw new Error("x");
    a.release();
    const again = g.enter("a");
    a.release();
    expect(g.enter("a").ok).toBe(false);
    expect(again.ok).toBe(true);
  });
});
