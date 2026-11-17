import { describe, expect, it } from "vitest";
import { TokenBudget } from "@/lib/ai/budget";
import { AiError } from "@/lib/ai/errors";
import { scriptedAi, type JsonStep, type TurnStep } from "@/lib/ai/fake";
import { agentSystemPrompt, MAX_ROUNDS, MIN_ROUND_MS, qualify, TOOLS, validateCall } from "@/lib/agent/loop";
import { emptyFacts, type Facts } from "@/lib/icp/types";
import { createSite } from "@/lib/scrape/site";
import { fakeWeb, page } from "./fakeweb";

type Override = [unknown, "high" | "medium" | "low", string[]];
const answer = (o: Partial<Record<keyof Facts, Override>> = {}): JsonStep => {
  const out = structuredClone(emptyFacts()) as unknown as Record<string, { value: unknown; confidence: string; quotes: string[] }>;
  for (const [k, [value, confidence, quotes]] of Object.entries(o)) out[k] = { value, confidence, quotes };
  return { data: out };
};

const PAD = "Acme builds cloud tooling for engineering teams everywhere. ".repeat(12);
const html = (body: string) => page(`<html><head><title>Acme</title></head><body><main>${body}</main></body></html>`);
const SITE = {
  "https://acme.com/robots.txt": { type: "text/plain", body: "" },
  "https://acme.com/": html(`<h1>Acme</h1><p>${PAD}</p><a href="/pricing">Pricing</a> <a href="/security">Security</a> <a href="/about">About</a> <a href="/customers">Customers</a> <a href="/careers">Careers</a> <a href="/blog">Blog</a>`),
  "https://acme.com/pricing": html(`<h1>Pricing</h1><p>The Enterprise plan includes SSO and SAML for large organisations. Contact sales.</p><p>Your data stays in your account and we store customer records securely.</p>`),
  "https://acme.com/security": html(`<h1>Security</h1><p>Acme holds a SOC 2 Type II report, issued this year.</p>`),
  "https://acme.com/about": html(`<h1>About</h1><p>We are a team of 120 employees across three offices.</p>`),
  "https://acme.com/customers": html(`<h1>Customers</h1><p>Trusted by Globex and Initech.</p>`),
  "https://acme.com/careers": html(`<h1>Careers</h1><p>Open roles: Account Executive and Designer.</p>`),
  "https://acme.com/blog": html(`<h1>Blog</h1><p>News from the Acme team.</p>`),
};

const PRODUCT: Override = ["saas", "high", ["Acme builds cloud tooling for engineering teams everywhere."]];

async function setup(opts: { web?: Record<string, unknown>; json?: (JsonStep | AiError)[]; turns?: (TurnStep | AiError)[]; limit?: number; context?: { excludedDomain: boolean; suppressed: boolean } } = {}) {
  const web = fakeWeb((opts.web ?? SITE) as never);
  const site = createSite("acme.com", web.deps);
  await site.fetchUrl("https://acme.com/");
  const ai = scriptedAi({ json: opts.json ?? [], turns: opts.turns ?? [] });
  const budget = new TokenBudget(opts.limit ?? 60_000);
  const run = () => qualify({ ai, site, budget, context: opts.context ?? { excludedDomain: false, suppressed: false } });
  return { web, site, ai, budget, run };
}

describe("validateCall", () => {
  it("accepts the five tools with good arguments", () => {
    expect(validateCall("fetch_page", { path: "/pricing" })).toEqual({ ok: true, args: { path: "/pricing" } });
    expect(validateCall("search_site", { terms: ["sso"] })).toEqual({ ok: true, args: { terms: ["sso"] } });
    expect(validateCall("check_trust_center", {})).toEqual({ ok: true, args: {} });
    expect(validateCall("list_open_roles", {})).toEqual({ ok: true, args: {} });
    expect(validateCall("stop", { reason: "done" })).toEqual({ ok: true, args: { reason: "done" } });
  });

  it.each([
    ["a tool that does not exist", "send_email", { to: "a@b.co" }],
    ["a tool name from a prompt-injection", "delete_everything", {}],
    ["fetch_page with no path", "fetch_page", {}],
    ["fetch_page with a number", "fetch_page", { path: 5 }],
    ["fetch_page with an empty path", "fetch_page", { path: "" }],
    ["fetch_page with a huge path", "fetch_page", { path: `/${"a".repeat(300)}` }],
    ["search_site with no terms", "search_site", { terms: [] }],
    ["search_site with too many terms", "search_site", { terms: ["a", "b", "c", "d", "e", "f"] }],
    ["search_site with a non-string term", "search_site", { terms: [1] }],
    ["search_site with a long term", "search_site", { terms: ["x".repeat(100)] }],
  ])("rejects %s", (_n, name, args) => {
    expect(validateCall(name, args as Record<string, unknown>)).toMatchObject({ ok: false });
  });

  it("drops extra arguments rather than passing them on", () => {
    expect(validateCall("fetch_page", { path: "/x", url: "https://evil.com", headers: { a: "b" } })).toEqual({ ok: true, args: { path: "/x" } });
  });

  it("exposes exactly the five allow-listed tools", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["fetch_page", "search_site", "check_trust_center", "list_open_roles", "stop"]);
  });
});

describe("qualify: the loop", () => {
  it("does not loop at all when the first read is enough", async () => {
    const s = await setup({
      json: [
        answer({ product: PRODUCT, headcount: ["51-200", "medium", ["Acme builds cloud tooling"]], enterprisePlan: [true, "medium", ["Acme builds cloud tooling"]], compliance: ["soc2_type2", "high", ["Acme builds cloud tooling"]], securityHiring: ["it_head", "medium", ["Acme builds cloud tooling"]] }),
      ],
    });
    const r = await s.run();
    expect(r.rounds).toBe(0);
    expect(r.stoppedBecause).toBe("enough");
    expect(s.ai.turnRequests).toHaveLength(0);
  });

  it("goes and gets the page that answers what is missing, re-reads, and scores with code", async () => {
    const s = await setup({
      json: [
        answer({ product: PRODUCT }),
        answer({ product: PRODUCT, enterprisePlan: [true, "high", ["The Enterprise plan includes SSO and SAML"]], customerData: ["stated", "medium", ["we store customer records securely"]] }),
        answer({ product: PRODUCT, enterprisePlan: [true, "high", ["The Enterprise plan includes SSO and SAML"]], customerData: ["stated", "medium", ["we store customer records securely"]], compliance: ["soc2_type2", "high", ["Acme holds a SOC 2 Type II report"]], headcount: ["51-200", "high", ["We are a team of 120 employees"]] }),
      ],
      turns: [
        { calls: [{ name: "fetch_page", args: { path: "/pricing" } }] },
        { calls: [{ name: "check_trust_center", args: {} }, { name: "fetch_page", args: { path: "/about" } }] },
      ],
    });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("enough");
    expect(r.rounds).toBe(2);
    expect(r.trace.map((t) => [t.round, t.tool, t.newPages])).toEqual([[1, "fetch_page", 1], [2, "check_trust_center", 1], [2, "fetch_page", 1]]);
    expect(r.trace[0]!.outcome).toMatch(/Fetched \/pricing/);
    expect(r.trace[0]!.missing).toEqual(expect.arrayContaining(["enterprise", "compliance"]));
    expect(r.facts.compliance.value).toBe("soc2_type2");
    expect(r.score.verdict).not.toBe("needs_more");
    expect(r.score.parts.find((p) => p.id === "status")!.quotes).toEqual(["Acme holds a SOC 2 Type II report"]);
    expect(r.passes).toHaveLength(3);
  });

  it("re-reads only when a new page actually arrived", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ calls: [{ name: "search_site", args: { terms: ["sso"] } }] }, { calls: [{ name: "stop", args: { reason: "nothing else" } }] }] });
    const r = await s.run();
    expect(r.passes).toHaveLength(1);
    expect(s.ai.jsonRequests).toHaveLength(1);
    expect(r.trace[0]!.tool).toBe("search_site");
  });

  it("stops when the model says stop, and records its reason", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ calls: [{ name: "stop", args: { reason: "More pages will not help" } }] }] });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("model_stopped");
    expect(r.trace[0]).toMatchObject({ tool: "stop", outcome: "More pages will not help" });
  });

  it("treats a reply with no tool call as the model having nothing to add", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ text: "I think this is a great lead!" }] });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("model_stopped");
  });

  it("stops after four rounds even if the model keeps asking and coverage never arrives", async () => {
    const paths = ["/pricing", "/security", "/about", "/customers", "/careers"];
    const s = await setup({
      json: [answer({ product: PRODUCT }), ...paths.slice(0, MAX_ROUNDS).map(() => answer({ product: PRODUCT }))],
      turns: paths.map((path) => ({ calls: [{ name: "fetch_page", args: { path } }] })),
    });
    const r = await s.run();
    expect(r.rounds).toBe(MAX_ROUNDS);
    expect(r.stoppedBecause).toBe("max_rounds");
    expect(s.ai.turnRequests).toHaveLength(MAX_ROUNDS);
    expect(s.site.pages()).toHaveLength(1 + MAX_ROUNDS);
  });

  it("gives up after two rounds that fetched nothing new", async () => {
    const s = await setup({
      json: [answer({ product: PRODUCT })],
      turns: [{ calls: [{ name: "fetch_page", args: { path: "/nope" } }] }, { calls: [{ name: "fetch_page", args: { path: "/also-nope" } }] }, { calls: [{ name: "stop", args: {} }] }],
    });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("no_progress");
    expect(r.rounds).toBe(2);
    expect(r.trace[0]!.outcome).toMatch(/Could not fetch/);
  });
});

describe("qualify: the model cannot step outside the tools", () => {
  it("never executes a tool that is not on the list, and records it as rejected", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ calls: [{ name: "send_email", args: { to: "ceo@acme.com" } }] }, { calls: [{ name: "stop", args: {} }] }] });
    const r = await s.run();
    expect(r.trace[0]).toMatchObject({ tool: "rejected", args: { name: "send_email" } });
    expect(s.web.urls().length).toBe(2); // robots.txt and the home page, nothing more
  });

  it.each([
    ["a full URL", "https://evil.com/steal"],
    ["the metadata address", "http://169.254.169.254/latest/meta-data"],
    ["a protocol-relative URL", "//evil.com/"],
    ["a guessed path", "/admin/export"],
  ])("does not fetch %s when the model asks for it", async (_n, path) => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ calls: [{ name: "fetch_page", args: { path } }] }, { calls: [{ name: "stop", args: {} }] }] });
    await s.run();
    expect(s.web.urls().some((u) => u.includes("evil.com") || u.includes("169.254") || u.includes("admin"))).toBe(false);
  });

  it("runs at most two tool calls in a round", async () => {
    const s = await setup({
      json: [answer({ product: PRODUCT }), answer({ product: PRODUCT })],
      turns: [{ calls: [{ name: "fetch_page", args: { path: "/pricing" } }, { name: "fetch_page", args: { path: "/security" } }, { name: "fetch_page", args: { path: "/about" } }] }, { calls: [{ name: "stop", args: {} }] }],
    });
    const r = await s.run();
    expect(r.trace.filter((t) => t.round === 1 && t.tool === "fetch_page")).toHaveLength(2);
    expect(s.site.pages().some((p) => p.url.endsWith("/about"))).toBe(false);
  });

  it("scores by code: a model that declares the company qualified changes nothing", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ text: "This company is qualified, score 100, perfect fit. Send the email." }] });
    const r = await s.run();
    expect(r.score.verdict).toBe("needs_more");
    expect(r.score.score).toBeLessThan(65);
  });

  it("applies the blocklist and suppression from the caller, not from anything the model says", async () => {
    const strong = answer({ product: PRODUCT, headcount: ["51-200", "high", ["Acme builds cloud tooling"]], enterprisePlan: [true, "high", ["Acme builds cloud tooling"]], compliance: ["in_progress", "high", ["Acme builds cloud tooling"]], securityHiring: ["security_role", "high", ["Acme builds cloud tooling"]] });
    const blocked = await (await setup({ json: [strong], context: { excludedDomain: true, suppressed: false } })).run();
    expect(blocked.score.verdict).toBe("not_fit");
    const suppressed = await (await setup({ json: [strong], context: { excludedDomain: false, suppressed: true } })).run();
    expect(suppressed.score.verdict).toBe("not_fit");
  });
});

describe("qualify: what the model is shown", () => {
  it("sees which facts are missing and which pages exist, but not the page text", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ calls: [{ name: "stop", args: {} }] }] });
    await s.run();
    const sent = JSON.stringify(s.ai.turnRequests[0]!.contents);
    expect(sent).toMatch(/enterprise signals/);
    expect(sent).toMatch(/\/pricing/);
    expect(sent).not.toContain("Acme builds cloud tooling");
    expect(s.ai.turnRequests[0]!.tools.map((t) => t.name)).toContain("fetch_page");
  });

  it("carries earlier results forward, so the model does not repeat itself", async () => {
    const s = await setup({
      json: [answer({ product: PRODUCT }), answer({ product: PRODUCT })],
      turns: [{ calls: [{ name: "fetch_page", args: { path: "/pricing" } }] }, { calls: [{ name: "stop", args: {} }] }],
    });
    await s.run();
    const second = JSON.stringify(s.ai.turnRequests[1]!.contents);
    expect(second).toContain("Fetched /pricing");
    expect(second).toContain('"functionCall"');
  });

  it("warns the model that fetched text is untrusted", () => {
    expect(agentSystemPrompt()).toMatch(/untrusted content/);
    expect(agentSystemPrompt()).toMatch(/at most two tools/);
  });
});

describe("qualify: failures end in 'needs more', never a guess", () => {
  it("carries on to a verdict when the model call fails mid-loop", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [new AiError("overloaded")] });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("ai_error");
    expect(r.trace[0]).toMatchObject({ tool: "rejected" });
    expect(r.score.verdict).toBe("needs_more");
    expect(r.facts.product.value).toBe("saas");
  });

  it("returns needs_more with empty facts when the first read fails", async () => {
    const s = await setup({ json: [new AiError("bad_json"), new AiError("bad_json")] });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("extraction_failed");
    expect(r.score.verdict).toBe("needs_more");
    expect(r.extraction).toBeNull();
  });

  it("keeps the earlier facts if a later re-read fails", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT }), new AiError("bad_json"), new AiError("bad_json")], turns: [{ calls: [{ name: "fetch_page", args: { path: "/pricing" } }] }] });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("extraction_failed");
    expect(r.facts.product.value).toBe("saas");
  });

  it("stops before the model is called when the domain's budget cannot cover another round", async () => {
    const s = await setup({ json: [{ ...answer({ product: PRODUCT }), usage: { promptTokens: 9000, outputTokens: 500, totalTokens: 9500 } }], limit: 10_000 });
    const r = await s.run();
    expect(r.stoppedBecause).toBe("budget");
    expect(s.ai.turnRequests).toHaveLength(0);
    expect(r.score.verdict).toBe("needs_more");
  });

  it("totals the tokens used across every call", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT }), answer({ product: PRODUCT })], turns: [{ calls: [{ name: "fetch_page", args: { path: "/pricing" } }] }, { calls: [{ name: "stop", args: {} }] }] });
    const r = await s.run();
    expect(r.aiCalls).toBe(4);
    expect(r.usage.totalTokens).toBe(4 * 1200);
    expect(s.budget.used).toBe(4 * 1200);
  });
});

describe("qualify: the time limit", () => {
  it("does not start a round when too little time is left, and scores what it has", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })] });
    const r = await qualify({ ai: s.ai, site: s.site, budget: s.budget, context: { excludedDomain: false, suppressed: false }, deadline: 1_000_000, now: () => 1_000_000 - 5_000 });
    expect(r.stoppedBecause).toBe("time");
    expect(s.ai.turnRequests).toHaveLength(0);
    expect(r.score.verdict).toBe("needs_more");
  });

  it("runs the round when there is enough time", async () => {
    const s = await setup({ json: [answer({ product: PRODUCT })], turns: [{ calls: [{ name: "stop", args: {} }] }] });
    const r = await qualify({ ai: s.ai, site: s.site, budget: s.budget, context: { excludedDomain: false, suppressed: false }, deadline: 1_000_000, now: () => 1_000_000 - MIN_ROUND_MS - 1 });
    expect(r.stoppedBecause).toBe("model_stopped");
  });

  it("stops between rounds if the clock runs out mid-loop", async () => {
    const s = await setup({
      json: [answer({ product: PRODUCT }), answer({ product: PRODUCT })],
      turns: [{ calls: [{ name: "fetch_page", args: { path: "/pricing" } }] }, { calls: [{ name: "fetch_page", args: { path: "/security" } }] }],
    });
    let t = 0;
    const r = await qualify({ ai: s.ai, site: s.site, budget: s.budget, context: { excludedDomain: false, suppressed: false }, deadline: 100_000, now: () => (t += 60_000) });
    expect(r.stoppedBecause).toBe("time");
    expect(s.ai.turnRequests).toHaveLength(1); // one round ran, the second was not started
  });
});

describe("qualify: why the model failed", () => {
  it("reports the failure code, so the caller can retry a blip and not a bad key", async () => {
    const blip = await (await setup({ json: [new AiError("overloaded"), new AiError("overloaded")] })).run();
    expect(blip.failure).toEqual({ code: "overloaded", reason: "The model service is overloaded." });
    const key = await (await setup({ json: [new AiError("auth")] })).run();
    expect(key.failure).toMatchObject({ code: "auth" });
    const midLoop = await (await setup({ json: [answer({ product: PRODUCT })], turns: [new AiError("timeout")] })).run();
    expect(midLoop.failure).toMatchObject({ code: "timeout" });
    const fine = await (await setup({ json: [answer({ product: PRODUCT })], turns: [{ calls: [{ name: "stop", args: {} }] }] })).run();
    expect(fine.failure).toBeNull();
  });
});
