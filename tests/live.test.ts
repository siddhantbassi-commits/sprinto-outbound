import { describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/errors";
import type { AiClient, ToolRequest } from "@/lib/ai/types";
import { seesContacts } from "@/lib/app/privacy";
import { HunterError, type HunterClient } from "@/lib/contacts/hunter";
import { cappedAi, createDailyCounter, createLiveGate, createTokenCap, domainOfPrompt, isSampleHost, KEEP_CREDITS, liveHunter, routeAi, routeFetch } from "@/lib/demo/live";
import { maskEmail, maskName } from "@/lib/email/mask";
import type { FetchDeps } from "@/lib/scrape/fetch";

const USAGE = { promptTokens: 100, outputTokens: 50, totalTokens: 150 };
const ai = (tag: string): AiClient & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    generateJson: async () => (calls.push(`json:${tag}`), { data: { tag }, usage: USAGE, model: tag, latencyMs: 1 }),
    generateTurn: async () => (calls.push(`turn:${tag}`), { text: tag, calls: [], finish: "stop", content: { role: "model", parts: [] }, usage: USAGE, model: tag, latencyMs: 1 }),
  };
};
const json = (user: string) => ({ purpose: "extract", system: "s", user, schema: {} });
const turn = (text: string): ToolRequest => ({ purpose: "loop", system: "s", contents: [{ role: "user", parts: [{ text }] }], tools: [] });

describe("which companies are samples", () => {
  it("knows the sample domains, with or without www and case", () => {
    expect(isSampleHost("harborpay.com")).toBe(true);
    expect(isSampleHost("WWW.HarborPay.com")).toBe(true);
    expect(isSampleHost("stripe.com")).toBe(false);
  });

  it("finds the company a prompt is about from either prompt shape", () => {
    expect(domainOfPrompt("<<<DATA 1f | home page: https://www.stripe.com/pricing>>>\ntext")).toBe("stripe.com");
    expect(domainOfPrompt("Company: Stripe (stripe.com)\nPerson: x")).toBe("stripe.com");
    expect(domainOfPrompt("nothing to see")).toBeNull();
  });
});

describe("routing to the real model", () => {
  it("sends only a plainly non-sample company to the real model", async () => {
    const scripted = ai("scripted");
    const real = ai("real");
    const r = routeAi(scripted, real);
    await r.generateJson(json("| home page: https://stripe.com/ text"));
    await r.generateJson({ ...json("Company: Stripe (stripe.com)\nx"), purpose: "draft" });
    await r.generateTurn(turn("| about page: https://stripe.com/about"));
    expect(real.calls).toEqual(["json:real", "json:real", "turn:real"]);
    expect(scripted.calls).toEqual([]);
  });

  it("keeps samples, and anything unclear, on the free scripted model so a mistake cannot spend tokens", async () => {
    const scripted = ai("scripted");
    const real = ai("real");
    const r = routeAi(scripted, real);
    await r.generateJson(json("| home page: https://harborpay.com/ text"));
    await r.generateJson(json("no marker at all"));
    await r.generateTurn(turn("no marker either"));
    await r.generateTurn(turn("Company: Harbor Pay (harborpay.com)"));
    expect(real.calls).toEqual([]);
    expect(scripted.calls).toHaveLength(4);
  });
});

describe("routing to the real internet", () => {
  const mk = (tag: string): FetchDeps & { seen: string[] } => {
    const seen: string[] = [];
    return { seen, userAgent: tag, resolve: async (h) => (seen.push(`resolve:${tag}:${h}`), ["93.184.216.34"]), transport: async ({ url }) => (seen.push(`get:${tag}:${url.hostname}`), { status: 200, headers: {}, body: Buffer.from(""), truncated: false }) };
  };

  it("serves samples from memory and everything else from the real fetcher, which keeps its own address guard", async () => {
    const scripted = mk("scripted");
    const real = mk("real");
    const r = routeFetch(scripted, real);
    await r.resolve("harborpay.com");
    await r.resolve("stripe.com");
    await r.transport({ url: new URL("https://harborpay.com/"), address: "1.1.1.1", headers: {}, timeoutMs: 1, maxBytes: 1 });
    await r.transport({ url: new URL("https://stripe.com/"), address: "1.1.1.1", headers: {}, timeoutMs: 1, maxBytes: 1 });
    expect(scripted.seen).toEqual(["resolve:scripted:harborpay.com", "get:scripted:harborpay.com"]);
    expect(real.seen).toEqual(["resolve:real:stripe.com", "get:real:stripe.com"]);
    expect(r.userAgent).toBe("real");
  });
});

describe("the daily token allowance", () => {
  it("counts what the real model spends, refuses the next call once it is gone, and starts again the next day", async () => {
    let t = Date.UTC(2026, 10, 18, 10);
    const cap = createTokenCap(300, () => t);
    const inner = ai("real");
    const c = cappedAi(inner, cap);
    await c.generateJson(json("a"));
    await c.generateTurn(turn("b"));
    expect(cap.used).toBe(300);
    await expect(c.generateJson(json("c"))).rejects.toMatchObject({ code: "budget" });
    await expect(c.generateTurn(turn("d"))).rejects.toBeInstanceOf(AiError);
    expect(inner.calls).toHaveLength(2);
    t += 24 * 3_600_000;
    await expect(c.generateJson(json("e"))).resolves.toBeTruthy();
    expect(cap.used).toBe(150);
  });
});

describe("limits on starting real companies", () => {
  const T0 = Date.UTC(2026, 10, 18, 10);

  it("never counts sample companies, and ignores what is not a domain", () => {
    const g = createLiveGate({ perRun: 1, perVisitorPerHour: 1, perDay: 1 }, () => T0);
    for (let i = 0; i < 5; i += 1) expect(g.check("a", ["harborpay.com", "northwind.io", "not a domain", "10.0.0.1"])).toEqual({ ok: true });
  });

  it("limits one run, and a run that is too big starts nothing", () => {
    const g = createLiveGate({ perRun: 3, perVisitorPerHour: 99, perDay: 99 }, () => T0);
    const r = g.check("a", ["a.com", "b.com", "c.com", "d.com"]);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/at most 3/);
    expect(g.check("a", ["a.com", "b.com", "c.com"])).toEqual({ ok: true });
  });

  it("counts a repeated company once, in one run", () => {
    const g = createLiveGate({ perRun: 2, perVisitorPerHour: 99, perDay: 99 }, () => T0);
    expect(g.check("a", ["a.com", "www.a.com", "A.com", "b.com"])).toEqual({ ok: true });
  });

  it("limits one visitor per hour, tells them how long to wait, and lets others carry on", () => {
    let t = T0;
    const g = createLiveGate({ perRun: 3, perVisitorPerHour: 4, perDay: 99 }, () => t);
    expect(g.check("a", ["a.com", "b.com", "c.com"])).toEqual({ ok: true });
    expect(g.check("a", ["d.com"])).toEqual({ ok: true });
    const r = g.check("a", ["e.com"]);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/Try again in about \d+ minute/);
    expect(g.check("b", ["e.com"])).toEqual({ ok: true });
    t += 61 * 60_000;
    expect(g.check("a", ["e.com"])).toEqual({ ok: true });
  });

  it("limits the whole demo per day, then starts again", () => {
    let t = T0;
    const g = createLiveGate({ perRun: 3, perVisitorPerHour: 99, perDay: 3 }, () => t);
    expect(g.check("a", ["a.com", "b.com", "c.com"])).toEqual({ ok: true });
    const r = g.check("z", ["d.com"]);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/used up its live research for today/);
    t += 25 * 3_600_000;
    expect(g.check("z", ["d.com"])).toEqual({ ok: true });
  });

  it("does not charge a refused request against the allowance", () => {
    const g = createLiveGate({ perRun: 3, perVisitorPerHour: 2, perDay: 99 }, () => T0);
    expect(g.check("a", ["a.com", "b.com", "c.com"]).ok).toBe(false);
    expect(g.check("a", ["a.com", "b.com"])).toEqual({ ok: true });
  });
});

describe("Hunter in the live demo", () => {
  const stub = (tag: string): HunterClient & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      account: async () => ({ remaining: 40, used: 10, available: 50, unit: "credits", resetDate: null }),
      domainSearch: async (d) => (calls.push(`search:${tag}:${d}`), { candidates: [], creditsUsed: 1, total: 0 }),
      verify: async (e) => (calls.push(`verify:${tag}:${e}`), { status: "valid", score: 90 }),
      discover: async () => (calls.push(`discover:${tag}`), { companies: [], total: 0 }),
    };
  };

  it("uses the stand-in for samples without counting, and the real one for everything else", async () => {
    const scripted = stub("scripted");
    const real = stub("real");
    const counter = createDailyCounter(5);
    const h = liveHunter(scripted, real, counter);
    await h.domainSearch("harborpay.com");
    await h.verify!("x@harborpay.com");
    await h.domainSearch("stripe.com");
    await h.verify!("p@stripe.com");
    expect(scripted.calls).toEqual(["search:scripted:harborpay.com", "verify:scripted:x@harborpay.com"]);
    expect(real.calls).toEqual(["search:real:stripe.com", "verify:real:p@stripe.com"]);
    expect(counter.used).toBe(2);
  });

  it("stops paid calls at the daily cap with a plain reason, using the quota path the pipeline already handles", async () => {
    const real = stub("real");
    const h = liveHunter(stub("s"), real, createDailyCounter(1));
    await h.domainSearch("a.com");
    const err = await h.domainSearch("b.com").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HunterError);
    expect((err as HunterError).code).toBe("quota");
    expect((err as Error).message).toMatch(/daily limit on contact lookups/);
    await expect(h.verify!("x@c.com")).rejects.toBeInstanceOf(HunterError);
    expect(real.calls).toEqual(["search:real:a.com"]);
  });

  it("keeps some of the owner's credits out of reach, and never goes negative", async () => {
    const h = liveHunter(stub("s"), stub("r"), createDailyCounter(5));
    expect((await h.account()).remaining).toBe(40 - KEEP_CREDITS);
    const low = { ...stub("r"), account: async () => ({ remaining: 3, used: 47, available: 50, unit: "credits" as const, resetDate: null }) };
    expect((await liveHunter(stub("s"), low, createDailyCounter(5)).account()).remaining).toBe(0);
  });

  it("finds companies for free, with no cap", async () => {
    const real = stub("real");
    const counter = createDailyCounter(0);
    const h = liveHunter(stub("s"), real, counter);
    await h.discover!({}, 5);
    await h.discover!({}, 5);
    expect(real.calls).toEqual(["discover:real", "discover:real"]);
    expect(counter.used).toBe(0);
  });

  it("counts from zero each day", () => {
    let t = Date.UTC(2026, 10, 18, 23);
    const c = createDailyCounter(1, () => t);
    expect(c.take()).toBe(true);
    expect(c.take()).toBe(false);
    t += 2 * 3_600_000;
    expect(c.take()).toBe(true);
  });
});

describe("keeping real people private", () => {
  it("shows a person as an initial and a masked address, like the database's own masked view", () => {
    expect(maskName("Imran")).toBe("I.");
    expect(maskName(null)).toBe("(name hidden)");
    expect(maskEmail("imran@harborpay.com")).toBe("i***@harborpay.com");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("not-an-email")).toBeNull();
  });

  it("lets nobody see contacts in the live demo, and keeps the old rule everywhere else", () => {
    expect(seesContacts({ user: { role: "admin" }, env: { live: { dailyTokens: 1 } } })).toBe(false);
    expect(seesContacts({ user: { role: "operator" }, env: { live: { dailyTokens: 1 } } })).toBe(false);
    expect(seesContacts({ user: { role: "admin" }, env: { live: null } })).toBe(true);
    expect(seesContacts({ user: { role: "viewer" }, env: { live: null } })).toBe(false);
  });
});

