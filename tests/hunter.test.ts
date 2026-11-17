import { describe, expect, it } from "vitest";
import { findCandidates, memoryCache, CACHE_TTL_MS, type FindDeps } from "@/lib/contacts/find";
import { createHunterClient, HunterError, readAccount, readDomainSearch, toCandidate, type HunterClient } from "@/lib/contacts/hunter";
import { ACCOUNT_TTL_MS, HunterBudget, planHunterBudget } from "@/lib/contacts/quota";
import { chooseContact, type Candidate } from "@/lib/contacts/rank";

const KEY = "hunter-secret-key-123";

const entry = (over: Record<string, unknown> = {}) => ({
  value: "priya@acme.com",
  type: "personal",
  confidence: 94,
  first_name: "Priya",
  last_name: "Rao",
  position: "CTO",
  seniority: "executive",
  department: "it",
  verification: { status: "valid", date: "2026-10-01" },
  ...over,
});
const search = (emails: unknown[], total = emails.length) => ({ data: { domain: "acme.com", emails }, meta: { results: total, limit: 10, offset: 0 } });
const account = (requests: unknown) => ({ data: { reset_date: "2026-12-01", requests } });
const pool = (used: number, available: number, remaining = available - used) => ({ used, available, remaining });

interface Sent {
  url: URL;
  headers: Record<string, string>;
}
function fakeFetch(answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fn = (async (url: URL, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string> });
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, sent };
}
const ok = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

describe("readAccount", () => {
  it("reads the credit pool when there is one", () => {
    expect(readAccount(account({ credits: pool(10, 50), searches: pool(10, 50), verifications: pool(0, 100) }))).toEqual({ remaining: 40, used: 10, available: 50, unit: "credits", resetDate: "2026-12-01" });
  });

  it("falls back to searches on plans without a credit pool", () => {
    expect(readAccount(account({ searches: pool(5, 25) }))).toMatchObject({ remaining: 20, unit: "searches" });
  });

  it("computes remaining when the field is missing, and never reports below zero", () => {
    expect(readAccount(account({ credits: { used: 5, available: 50 } })).remaining).toBe(45);
    expect(readAccount(account({ credits: { used: 60, available: 50 } })).remaining).toBe(0);
    expect(readAccount(account({ credits: { used: 1, available: 50, remaining: -4 } })).remaining).toBe(0);
  });

  it.each([null, {}, { data: {} }, { data: { requests: {} } }, "x", []])("rejects a malformed answer: %j", (bad) => {
    expect(() => readAccount(bad)).toThrowError(expect.objectContaining({ code: "bad_response" }));
  });
});

describe("toCandidate", () => {
  it("maps a Hunter entry to the ranker's candidate", () => {
    expect(toCandidate(entry())).toEqual({
      source: "hunter", firstName: "Priya", lastName: "Rao", position: "CTO", email: "priya@acme.com", type: "personal", seniority: "executive", department: "it", confidence: 94, verification: "valid",
    });
  });

  it("drops an entry with no address, and tolerates missing and odd fields", () => {
    expect(toCandidate(entry({ value: null }))).toBeNull();
    expect(toCandidate(entry({ value: "  " }))).toBeNull();
    expect(toCandidate(null)).toBeNull();
    expect(toCandidate("x")).toBeNull();
    const odd = toCandidate(entry({ type: "robot", seniority: "wizard", confidence: 900, first_name: null, position: "", verification: { status: "mystery" } }))!;
    expect(odd).toMatchObject({ type: null, seniority: null, confidence: 100, firstName: null, position: null, verification: "unknown" });
    expect(toCandidate(entry({ verification: undefined }))!.verification).toBeNull();
    expect(toCandidate(entry({ confidence: -5 }))!.confidence).toBe(0);
  });

  it("produces candidates the ranker can use", () => {
    const c = toCandidate(entry())!;
    const out = chooseContact([c, toCandidate(entry({ value: "sales@acme.com", type: "generic", first_name: null, position: "Sales" }))!], "51-200");
    expect(out.chosen?.candidate.email).toBe("priya@acme.com");
  });
});

describe("readDomainSearch", () => {
  it("reads the credits used from the header, and total from meta", () => {
    const r = readDomainSearch(search([entry()], 37), "1");
    expect(r).toMatchObject({ creditsUsed: 1, total: 37 });
    expect(r.candidates).toHaveLength(1);
  });

  it("assumes Hunter's own rule when the header is missing or odd: one credit if anything came back", () => {
    expect(readDomainSearch(search([entry()]), null).creditsUsed).toBe(1);
    expect(readDomainSearch(search([]), null).creditsUsed).toBe(0);
    expect(readDomainSearch(search([entry()]), "lots").creditsUsed).toBe(1);
    expect(readDomainSearch(search([entry()]), "0").creditsUsed).toBe(0);
    expect(readDomainSearch(search([entry()]), "0.5").creditsUsed).toBe(0.5);
  });

  it("rejects an answer with no emails array", () => {
    expect(() => readDomainSearch({ data: {} }, null)).toThrow(HunterError);
    expect(() => readDomainSearch(null, null)).toThrow(HunterError);
  });
});

describe("Hunter client", () => {
  it("sends the key in a header and never in the URL", async () => {
    const f = fakeFetch([ok(search([entry()]), { "X-Credits-Used": "1" })]);
    await createHunterClient({ apiKey: ` ${KEY}\n`, fetchFn: f.fn }).domainSearch("acme.com");
    expect(f.sent[0]!.headers["X-API-KEY"]).toBe(KEY);
    expect(f.sent[0]!.url.href).not.toContain(KEY);
    expect(f.sent[0]!.url.searchParams.has("api_key")).toBe(false);
  });

  it("asks for personal, senior and executive contacts for the domain", async () => {
    const f = fakeFetch([ok(search([entry()]))]);
    await createHunterClient({ apiKey: KEY, fetchFn: f.fn }).domainSearch("Acme.com");
    const q = f.sent[0]!.url.searchParams;
    expect(f.sent[0]!.url.pathname).toBe("/v2/domain-search");
    expect([q.get("domain"), q.get("type"), q.get("seniority"), q.get("limit")]).toEqual(["acme.com", "personal", "senior,executive", "10"]);
  });

  it("clamps the limit to what Hunter allows", async () => {
    const f = fakeFetch([ok(search([])), ok(search([]))]);
    const c = createHunterClient({ apiKey: KEY, fetchFn: f.fn });
    await c.domainSearch("acme.com", { limit: 5000 });
    await c.domainSearch("acme.com", { limit: 0 });
    expect(f.sent.map((s) => s.url.searchParams.get("limit"))).toEqual(["100", "1"]);
  });

  it.each(["acme.com&limit=100", "http://169.254.169.254", "10.0.0.1", "", "a b.com", "localhost"])("refuses a bad domain without a request: %s", async (domain) => {
    const f = fakeFetch([]);
    await expect(createHunterClient({ apiKey: KEY, fetchFn: f.fn }).domainSearch(domain)).rejects.toMatchObject({ code: "bad_request" });
    expect(f.sent).toHaveLength(0);
  });

  it.each(["acme.com?api_key=x", "acme.com/../x", "https://acme.com/path?x=1#frag"])("reduces %s to the bare host, so nothing can be added to the query", async (domain) => {
    const f = fakeFetch([ok(search([]))]);
    await createHunterClient({ apiKey: KEY, fetchFn: f.fn }).domainSearch(domain);
    const q = f.sent[0]!.url.searchParams;
    expect(q.get("domain")).toBe("acme.com");
    expect([...q.keys()].sort()).toEqual(["domain", "limit", "seniority", "type"]);
  });

  it("reads the account from /account", async () => {
    const f = fakeFetch([ok(account({ credits: pool(2, 50) }))]);
    expect(await createHunterClient({ apiKey: KEY, fetchFn: f.fn }).account()).toMatchObject({ remaining: 48 });
    expect(f.sent[0]!.url.pathname).toBe("/v2/account");
  });

  it.each([
    [401, "auth"],
    [429, "quota"],
    [403, "rate_limited"],
    [400, "bad_request"],
    [500, "api_error"],
    [404, "api_error"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const f = fakeFetch([new Response(JSON.stringify({ errors: [{ details: `secret ${KEY}` }] }), { status })]);
    await expect(createHunterClient({ apiKey: KEY, fetchFn: f.fn }).domainSearch("acme.com")).rejects.toMatchObject({ code });
  });

  it("never carries the key or Hunter's text in an error", async () => {
    const f = fakeFetch([new Response(JSON.stringify({ errors: [{ details: `invalid key ${KEY}` }] }), { status: 401 })]);
    const err = await createHunterClient({ apiKey: KEY, fetchFn: f.fn }).account().catch((e: unknown) => e);
    expect(`${(err as Error).message} ${JSON.stringify(err)} ${(err as Error).stack}`).not.toContain(KEY);
  });

  it("reports a stall as a timeout, a network failure as an API error, and unreadable JSON as a bad response", async () => {
    const slow = (async (_u: URL, init: RequestInit) => new Promise<Response>((_, reject) => (init.signal as AbortSignal).addEventListener("abort", () => reject((init.signal as AbortSignal).reason)))) as unknown as typeof fetch;
    await expect(createHunterClient({ apiKey: KEY, fetchFn: slow, timeoutMs: 20 }).account()).rejects.toMatchObject({ code: "timeout" });
    await expect(createHunterClient({ apiKey: KEY, fetchFn: fakeFetch([new TypeError("fetch failed")]).fn }).account()).rejects.toMatchObject({ code: "api_error" });
    await expect(createHunterClient({ apiKey: KEY, fetchFn: fakeFetch([new Response("<html>", { status: 200 })]).fn }).account()).rejects.toMatchObject({ code: "bad_response" });
  });

  it("will not be built without a key", () => {
    expect(() => createHunterClient({ apiKey: "  " })).toThrowError(expect.objectContaining({ code: "not_configured" }));
  });
});

describe("planHunterBudget (shown before a run)", () => {
  it("covers every domain when the credits allow, keeping the reserve", () => {
    const p = planHunterBudget({ remaining: 20, requested: 10 });
    expect(p).toMatchObject({ allowed: 10, trimmed: 0, reserve: 3 });
    expect(p.message).toBe("10 domains will use 10 Hunter credits of 20 left (keeping 3 in reserve).");
  });

  it("trims to what is affordable after the reserve, and says what happens to the rest", () => {
    const p = planHunterBudget({ remaining: 8, requested: 12 });
    expect(p).toMatchObject({ allowed: 5, trimmed: 7 });
    expect(p.message).toMatch(/only 5 of 12 domains/);
    expect(p.message).toMatch(/review lane/);
  });

  it("allows nothing at or below the reserve", () => {
    expect(planHunterBudget({ remaining: 3, requested: 2 }).allowed).toBe(0);
    expect(planHunterBudget({ remaining: 0, requested: 2 }).allowed).toBe(0);
    expect(planHunterBudget({ remaining: 2, requested: 1 }).allowed).toBe(0);
  });

  it("says nothing is needed when everything is cached or manual", () => {
    expect(planHunterBudget({ remaining: 20, requested: 0, cached: 4, manual: 1 }).message).toMatch(/No Hunter credits needed/);
    expect(planHunterBudget({ remaining: 20, requested: 0 }).message).toBe("Nothing to look up.");
    expect(planHunterBudget({ remaining: 20, requested: 1 }).message).toMatch(/1 domain will use 1 Hunter credit of/);
  });

  it("handles a fractional or negative balance without going wrong", () => {
    expect(planHunterBudget({ remaining: 7.9, requested: 10 }).allowed).toBe(4);
    expect(planHunterBudget({ remaining: -2, requested: 3 }).allowed).toBe(0);
  });
});

describe("HunterBudget (the live balance)", () => {
  it("reads the account once and reuses it for ten minutes", async () => {
    let t = 0;
    const calls = { n: 0 };
    const b = new HunterBudget({ account: async () => (calls.n++, { remaining: 20, used: 0, available: 20, unit: "credits", resetDate: null }) }, { now: () => t });
    await b.snapshot();
    t += ACCOUNT_TTL_MS - 1;
    await b.snapshot();
    expect(calls.n).toBe(1);
    t += 2;
    await b.snapshot();
    expect(calls.n).toBe(2);
  });

  it("subtracts local spending between reads, so a burst cannot overshoot a stale balance", async () => {
    const calls = { n: 0 };
    const b = new HunterBudget({ account: async () => (calls.n++, { remaining: 5, used: 0, available: 5, unit: "credits", resetDate: null }) });
    expect((await b.snapshot()).spendable).toBe(2);
    b.record(1);
    b.record(1);
    expect(await b.canSpend(1)).toBe(false);
    expect(calls.n).toBe(1);
  });

  it("never lets spending cut into the reserve", async () => {
    const b = new HunterBudget({ account: async () => ({ remaining: 4, used: 0, available: 4, unit: "credits", resetDate: null }) }, { reserve: 3 });
    expect(await b.canSpend(1)).toBe(true);
    b.record(1);
    expect(await b.canSpend(1)).toBe(false);
  });

  it("stops when Hunter says the credits are gone, and resumes after a fresh read", async () => {
    let t = 0;
    const b = new HunterBudget({ account: async () => ({ remaining: 50, used: 0, available: 50, unit: "credits", resetDate: null }) }, { now: () => t });
    expect(await b.canSpend(1)).toBe(true);
    b.markExhausted();
    expect(await b.canSpend(1)).toBe(false);
    t += ACCOUNT_TTL_MS + 1;
    expect(await b.canSpend(1)).toBe(true);
  });

  it("passes on an account error rather than guessing a balance", async () => {
    const b = new HunterBudget({ account: async () => { throw new HunterError("auth"); } });
    await expect(b.canSpend()).rejects.toMatchObject({ code: "auth" });
  });
});

describe("findCandidates (manual, cache, Hunter, nothing)", () => {
  const cand = (over: Partial<Candidate> = {}): Candidate => ({ ...(toCandidate(entry()) as Candidate), ...over });
  const harness = (opts: { remaining?: number; search?: () => Promise<{ candidates: Candidate[]; creditsUsed: number; total: number }> } = {}) => {
    const log = { searches: 0, accounts: 0 };
    const hunter: HunterClient = {
      account: async () => (log.accounts++, { remaining: opts.remaining ?? 20, used: 0, available: 20, unit: "credits", resetDate: null }),
      domainSearch: async () => (log.searches++, opts.search ? opts.search() : { candidates: [cand()], creditsUsed: 1, total: 1 }),
    };
    const budget = new HunterBudget(hunter);
    const cache = memoryCache();
    let t = 1_000_000;
    const deps: FindDeps = { hunter, budget, cache, now: () => t };
    return { deps, log, cache, budget, advance: (ms: number) => (t += ms) };
  };

  it("uses a hand-picked contact first and spends no credit", async () => {
    const h = harness();
    const r = await findCandidates("acme.com", [cand({ source: "manual", email: "me@acme.com" })], h.deps);
    expect(r).toMatchObject({ source: "manual", creditsSpent: 0 });
    expect(h.log).toEqual({ searches: 0, accounts: 0 });
  });

  it("ignores a manual list that holds only Hunter rows", async () => {
    const h = harness();
    expect((await findCandidates("acme.com", [cand()], h.deps)).source).toBe("hunter");
  });

  it("calls Hunter once, caches the whole answer, and uses the cache next time", async () => {
    const h = harness();
    const first = await findCandidates("acme.com", [], h.deps);
    expect(first).toMatchObject({ source: "hunter", creditsSpent: 1 });
    const second = await findCandidates("acme.com", [], h.deps);
    expect(second).toMatchObject({ source: "cache", creditsSpent: 0 });
    expect(second.detail).toMatch(/0 days ago/);
    expect(h.log.searches).toBe(1);
  });

  it("asks again after the cache is thirty days old", async () => {
    const h = harness();
    await findCandidates("acme.com", [], h.deps);
    h.advance(CACHE_TTL_MS - 1);
    expect((await findCandidates("acme.com", [], h.deps)).source).toBe("cache");
    h.advance(2);
    expect((await findCandidates("acme.com", [], h.deps)).source).toBe("hunter");
    expect(h.log.searches).toBe(2);
  });

  it("refuses to spend into the reserve and says why", async () => {
    const h = harness({ remaining: 3 });
    const r = await findCandidates("acme.com", [], h.deps);
    expect(r).toMatchObject({ source: "none", reason: "budget", creditsSpent: 0 });
    expect(r.detail).toMatch(/3 credits left and 3 are kept in reserve/);
    expect(h.log.searches).toBe(0);
  });

  it("stops asking after the balance runs down mid-run", async () => {
    const h = harness({ remaining: 5 });
    const a = await findCandidates("a.com", [], h.deps);
    const b = await findCandidates("b.com", [], h.deps);
    const c = await findCandidates("c.com", [], h.deps);
    expect([a.source, b.source, c.source]).toEqual(["hunter", "hunter", "none"]);
    expect(h.log.searches).toBe(2);
  });

  it("caches an empty answer so the same dead end does not cost another credit", async () => {
    const h = harness({ search: async () => ({ candidates: [], creditsUsed: 0, total: 0 }) });
    const first = await findCandidates("acme.com", [], h.deps);
    expect(first).toMatchObject({ source: "none", reason: "no_results", creditsSpent: 0 });
    const again = await findCandidates("acme.com", [], h.deps);
    expect(again).toMatchObject({ source: "none", reason: "no_results" });
    expect(h.log.searches).toBe(1);
  });

  it("does not cache a failure, and reports it as a Hunter error", async () => {
    const h = harness({ search: async () => { throw new HunterError("api_error"); } });
    const r = await findCandidates("acme.com", [], h.deps);
    expect(r).toMatchObject({ source: "none", reason: "hunter_error" });
    expect(h.cache.size).toBe(0);
  });

  it("treats Hunter's own 'usage limit' answer as the end of the credits for this run", async () => {
    let n = 0;
    const h = harness({ search: async () => { n += 1; throw new HunterError("quota"); } });
    const a = await findCandidates("a.com", [], h.deps);
    const b = await findCandidates("b.com", [], h.deps);
    expect(a).toMatchObject({ reason: "quota_exhausted" });
    expect(b).toMatchObject({ reason: "budget" });
    expect(n).toBe(1);
  });

  it("charges what Hunter reports, not a fixed 1", async () => {
    const h = harness({ remaining: 20, search: async () => ({ candidates: [cand()], creditsUsed: 0, total: 1 }) });
    const r = await findCandidates("acme.com", [], h.deps);
    expect(r.creditsSpent).toBe(0);
    expect((await h.budget.snapshot()).remaining).toBe(20);
  });

  it("returns the account error as a Hunter error rather than guessing a balance", async () => {
    const h = harness();
    h.deps.hunter.account = async () => { throw new HunterError("auth"); };
    expect(await findCandidates("acme.com", [], h.deps)).toMatchObject({ source: "none", reason: "hunter_error" });
  });
});
