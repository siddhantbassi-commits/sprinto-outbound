import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { describe, expect, it } from "vitest";
import { demoAi, extractionFor } from "@/lib/demo/ai";
import { DEMO_BY_DOMAIN } from "@/lib/demo/companies";
import { demoFetchDeps, demoHunter } from "@/lib/demo/world";
import { envChecks, formatValue, KEY_DEFS, mergeEnv, parseEnv, SECRET_NAMES } from "@/lib/smoke/envfile";
import { geminiChecks } from "@/lib/smoke/gemini";
import { gmailChecks } from "@/lib/smoke/gmail";
import { hunterChecks } from "@/lib/smoke/hunter";
import { networkChecks } from "@/lib/smoke/network";
import { dryRun } from "@/lib/smoke/pipeline";
import { fail, pass, redact, render, safely, summarise, type Check } from "@/lib/smoke/report";
import { supabaseChecks, type SbClient } from "@/lib/smoke/supabase";
import { SPRINTO_FACTS_SEED } from "@/lib/pitch/sprinto-facts";
import { fakeWeb, page } from "./fakeweb";

const by = (cs: Check[], id: string) => cs.find((c) => c.id === id);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ================================================================ report
describe("report", () => {
  it("redacts every secret and any bearer token, and ignores short strings", () => {
    const out = redact("key=AIzaSECRET123456 and Bearer abcdefghijklmnop and ok", ["AIzaSECRET123456", "ab", undefined, null]);
    expect(out).toBe("key=[hidden] and Bearer [hidden] and ok");
    expect(redact("a b a", ["a"])).toBe("a b a");
  });

  it("says READY only for a clean sheet, NOT FINISHED when something is unchecked or worth a look, NOT READY on a failure", () => {
    expect(summarise([pass("s", "a", "t", "d")]).verdict).toBe("ready");
    expect(summarise([pass("s", "a", "t", "d"), { section: "s", id: "b", title: "t", status: "skip", detail: "d" }]).verdict).toBe("unfinished");
    expect(summarise([{ section: "s", id: "b", title: "t", status: "warn", detail: "d" }]).verdict).toBe("unfinished");
    expect(summarise([fail("s", "a", "t", "d"), pass("s", "b", "t", "d")])).toMatchObject({ verdict: "not-ready", ok: false, fail: 1, pass: 1 });
    expect(summarise([]).verdict).toBe("ready");
  });

  it("renders a hint under the line and redacts secrets in the whole report", () => {
    const text = render([fail("gemini", "x", "The key works", "refused SUPERSECRET99", "Check SUPERSECRET99 again")], { secrets: ["SUPERSECRET99"] });
    expect(text).not.toContain("SUPERSECRET99");
    expect(text).toContain("GEMINI");
    expect(text).toContain("→ Check [hidden] again");
    expect(text).toContain("NOT READY");
  });

  it("turns a thrown error into a failed check instead of crashing", async () => {
    const out = await safely("s", "id", "Title", async () => {
      throw new Error("boom");
    });
    expect(out).toEqual([fail("s", "id", "Title", "boom")]);
    expect(await safely("s", "id", "Title", async () => pass("s", "id", "Title", "ok"))).toHaveLength(1);
  });
});

// ================================================================ network
describe("networkChecks", () => {
  const echoResolver = async (h: string) => (isIP(h) ? [h] : ["93.184.216.34"]);
  const mk = (routes: Record<string, unknown>, resolve = echoResolver) => {
    const w = fakeWeb(routes as never);
    return { ...w.deps, resolve };
  };

  it("passes when the guard holds and a real page and robots.txt can be read", async () => {
    const cs = await networkChecks(mk({ "https://example.com/": page("<html><head><title>Example Domain</title></head><body><p>Hello</p></body></html>"), "https://example.com/robots.txt": { type: "text/plain", body: "" } }));
    expect(cs.map((c) => c.status)).toEqual(["pass", "pass", "pass"]);
    expect(by(cs, "fetch")!.detail).toMatch(/title "Example Domain"/);
  });

  it("fails loudly if the guard would let an internal address through", async () => {
    const cs = await networkChecks(mk({}, async () => ["93.184.216.34"]));
    expect(by(cs, "guard")).toMatchObject({ status: "fail", hint: expect.stringMatching(/Do not run the scraper/) });
  });

  it("fails, with the status, when the page does not come back", async () => {
    const cs = await networkChecks(mk({ "https://example.com/": { status: 500, body: "x" } }));
    expect(by(cs, "fetch")).toMatchObject({ status: "fail", detail: expect.stringContaining("500") });
  });
});

// ================================================================ gemini
interface FakeGemini {
  fetchFn: typeof fetch;
  calls: { url: string; kind: string }[];
}

/** A fake Gemini API. `behave` decides each model's answer; the default is a model that does everything right. */
function fakeGemini(o: { listed?: string[]; status?: number; behave?: (model: string, kind: "tiny" | "facts" | "tools", body: Record<string, unknown>) => Response | null } = {}): FakeGemini {
  const calls: FakeGemini["calls"] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/models?pageSize")) {
      calls.push({ url: u, kind: "list" });
      if (o.status) return json({ error: { status: "PERMISSION_DENIED" } }, o.status);
      return json({ models: (o.listed ?? ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.8-flash"]).map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ["generateContent"] })) });
    }
    const model = /models\/([^:]+):generateContent/.exec(u)![1]!;
    const body = JSON.parse(String(init!.body)) as { generationConfig?: { responseSchema?: { required?: string[] } }; tools?: unknown };
    const kind = body.tools ? "tools" : (body.generationConfig?.responseSchema?.required?.length ?? 0) > 5 ? "facts" : "tiny";
    calls.push({ url: model, kind });
    const custom = o.behave?.(model, kind, body as never);
    if (custom) return custom;
    const usage = { usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 100, totalTokenCount: 1000 } };
    if (kind === "tiny") return json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], ...usage });
    if (kind === "facts") return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(extractionFor(DEMO_BY_DOMAIN.get("northwind.io")!)) }] }, finishReason: "STOP" }], ...usage });
    return json({ candidates: [{ content: { parts: [{ functionCall: { name: "fetch_page", args: { path: "/pricing" } } }] }, finishReason: "STOP" }], ...usage });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const KEY = "AIzaSy-smoke-test-key-123456";

describe("geminiChecks", () => {
  it("passes everything for a key whose models list, answer in JSON mode, extract cleanly and call tools", async () => {
    const g = fakeGemini();
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: g.fetchFn });
    expect(cs.filter((c) => c.status !== "pass").map((c) => `${c.id}:${c.detail}`)).toEqual([]);
    expect(cs.map((c) => c.id)).toEqual(["list", "model:gemini-3.6-flash", "model:gemini-3.5-flash-lite", "model:gemini-flash-latest", "extract", "tools"]);
    expect(by(cs, "extract")!.detail).toMatch(/Nullable with enum was accepted/);
    expect(by(cs, "extract")!.detail).toMatch(/\d+ of 19 facts known, \d+ quotes checked, 0 not found on the page, 0 off-spec/);
  });

  it("fails with real names to use when none of the chain exists for this key", async () => {
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: fakeGemini({ listed: ["gemini-9.9-flash", "gemini-9.8-flash-lite"] }).fetchFn });
    expect(by(cs, "list")).toMatchObject({ status: "fail", hint: expect.stringContaining("gemini-9.9-flash") });
  });

  it("warns, and names the missing model, when only some of the chain exists", async () => {
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: fakeGemini({ listed: ["gemini-3.6-flash", "gemini-3.5-flash-lite"] }).fetchFn });
    expect(by(cs, "list")).toMatchObject({ status: "warn", detail: expect.stringContaining("gemini-flash-latest") });
  });

  it("stops at once, with nothing else tried, when the key is refused", async () => {
    const g = fakeGemini({ status: 403 });
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: g.fetchFn });
    expect(cs).toHaveLength(1);
    expect(cs[0]!.status).toBe("fail");
    expect(g.calls.filter((c) => c.kind !== "list")).toHaveLength(0);
  });

  it("falls back to the next model when the preferred one does not answer, and says so", async () => {
    const g = fakeGemini({ behave: (m) => (m === "gemini-3.6-flash" ? json({ error: { status: "NOT_FOUND" } }, 404) : null) });
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: g.fetchFn });
    expect(by(cs, "model:gemini-3.6-flash")!.status).toBe("fail");
    expect(by(cs, "chain")).toMatchObject({ status: "warn", detail: expect.stringContaining("gemini-3.5-flash-lite") });
    expect(by(cs, "extract")!.status).toBe("pass");
  });

  it("fails and skips the deeper checks when no model answers at all", async () => {
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: fakeGemini({ behave: () => json({ error: {} }, 404) }).fetchFn });
    expect(by(cs, "chain")!.status).toBe("fail");
    expect(by(cs, "extract")).toBeUndefined();
  });

  it("points at nullable-with-enum when the full schema is rejected", async () => {
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: fakeGemini({ behave: (_m, kind) => (kind === "facts" ? json({ error: { message: "bad schema" } }, 400) : null) }).fetchFn });
    expect(by(cs, "extract")).toMatchObject({ status: "fail" });
    const bad = fakeGemini({ behave: (_m, kind) => (kind === "facts" ? json({ candidates: [{ content: { parts: [{ text: "not json" }] }, finishReason: "STOP" }] }) : null) });
    expect(by(await geminiChecks({ apiKey: KEY, fetchFn: bad.fetchFn }), "extract")).toMatchObject({ status: "fail", hint: expect.stringContaining("nullable") });
  });

  it("warns when the model's answer has off-spec values or quotes that are not on the page", async () => {
    const wrong = { ...extractionFor(DEMO_BY_DOMAIN.get("northwind.io")!) } as Record<string, unknown>;
    wrong.product = { value: "unicorn", confidence: "high", quotes: ["x quote here"] };
    wrong.compliance = { value: "soc2_type2", confidence: "high", quotes: ["a quote that is on no page"] };
    const g = fakeGemini({ behave: (_m, kind) => (kind === "facts" ? json({ candidates: [{ content: { parts: [{ text: JSON.stringify(wrong) }] }, finishReason: "STOP" }] }) : null) });
    const c = by(await geminiChecks({ apiKey: KEY, fetchFn: g.fetchFn }), "extract")!;
    expect(c.status).toBe("warn");
    expect(c.hint).toMatch(/Off-spec: product/);
  });

  it("warns when the model replies in words instead of calling a tool", async () => {
    const g = fakeGemini({ behave: (_m, kind) => (kind === "tools" ? json({ candidates: [{ content: { parts: [{ text: "I would look at pricing." }] }, finishReason: "STOP" }] }) : null) });
    expect(by(await geminiChecks({ apiKey: KEY, fetchFn: g.fetchFn }), "tools")).toMatchObject({ status: "warn", detail: expect.stringContaining("answered in text") });
  });

  it("warns, rather than trusting it, when the model calls a tool with arguments our check rejects", async () => {
    const g = fakeGemini({ behave: (_m, kind) => (kind === "tools" ? json({ candidates: [{ content: { parts: [{ functionCall: { name: "send_email", args: { to: "a@b.co" } } }] }, finishReason: "STOP" }] }) : null) });
    expect(by(await geminiChecks({ apiKey: KEY, fetchFn: g.fetchFn }), "tools")).toMatchObject({ status: "warn", detail: expect.stringContaining("failed our argument check") });
  });

  it("pins one model when asked, and checks only that one", async () => {
    const g = fakeGemini();
    const cs = await geminiChecks({ apiKey: KEY, pinned: "gemini-3.6-flash", fetchFn: g.fetchFn });
    expect(cs.filter((c) => c.id.startsWith("model:")).map((c) => c.id)).toEqual(["model:gemini-3.6-flash"]);
  });

  it("never puts the key in a check", async () => {
    const cs = await geminiChecks({ apiKey: KEY, fetchFn: fakeGemini({ behave: () => json({ error: { message: `bad key ${KEY}` } }, 500) }).fetchFn });
    expect(JSON.stringify(cs)).not.toContain(KEY);
  });
});

// ================================================================ hunter
const account = (remaining: number) => json({ data: { reset_date: "2026-12-01", requests: { credits: { used: 50 - remaining, available: 50, remaining } } } });
const hit = (extra: Record<string, unknown> = {}) => ({ value: "priya.rao@acme.com", type: "personal", confidence: 95, first_name: "Priya", last_name: "Rao", position: "CTO", seniority: "executive", department: "it", verification: { status: "valid" }, ...extra });
const search = (emails: unknown[]) => new Response(JSON.stringify({ data: { emails }, meta: { results: emails.length } }), { status: 200, headers: { "X-Credits-Used": emails.length ? "1" : "0" } });

describe("hunterChecks", () => {
  const opts = (fetchFn: typeof fetch, searchDomain?: string) => ({ apiKey: "hunter-key-abcdefghijkl", reserve: 3, searchDomain, fetchFn });

  it("passes with a healthy balance, saying how many domains it covers, and does not spend a credit unasked", async () => {
    const calls: string[] = [];
    const cs = await hunterChecks(opts((async (u: URL) => (calls.push(u.pathname), account(40))) as unknown as typeof fetch));
    expect(by(cs, "account")).toMatchObject({ status: "pass", detail: expect.stringContaining("up to 37 domains") });
    expect(by(cs, "search")!.status).toBe("skip");
    expect(calls).toEqual(["/v2/account"]);
  });

  it("warns when the balance is at or under the reserve, and fails on a refused key", async () => {
    expect(by(await hunterChecks(opts((async () => account(3)) as unknown as typeof fetch)), "account")!.status).toBe("warn");
    expect(by(await hunterChecks(opts((async () => new Response("{}", { status: 401 })) as unknown as typeof fetch)), "account")).toMatchObject({ status: "fail", detail: expect.stringContaining("refused the API key") });
  });

  it("reports a real search with masked addresses and the credits spent", async () => {
    const f = (async (u: URL) => (u.pathname.endsWith("/account") ? account(40) : search([hit(), hit({ value: "sales@acme.com", type: "generic", first_name: null, position: "Sales" })]))) as unknown as typeof fetch;
    const c = by(await hunterChecks(opts(f, "acme.com")), "search")!;
    expect(c.status).toBe("pass");
    expect(c.detail).toMatch(/2 candidates of 2 on file; 1 credits used; ranked first: CTO \(p\*\*\*@acme\.com\)/);
    expect(c.detail).not.toContain("priya.rao@acme.com");
  });

  it("warns, with no credit spent, when Hunter has nobody; and points at the request words on a 400", async () => {
    const none = (async (u: URL) => (u.pathname.endsWith("/account") ? account(40) : search([]))) as unknown as typeof fetch;
    expect(by(await hunterChecks(opts(none, "tiny.co")), "search")).toMatchObject({ status: "warn", detail: expect.stringContaining("0 credits used") });
    const bad = (async (u: URL) => (u.pathname.endsWith("/account") ? account(40) : new Response("{}", { status: 400 }))) as unknown as typeof fetch;
    expect(by(await hunterChecks(opts(bad, "acme.com")), "search")).toMatchObject({ status: "fail", hint: expect.stringContaining("live list") });
  });
});

// ================================================================ gmail
const SEND = "https://www.googleapis.com/auth/gmail.send";
const G = { clientId: "client-id-abcdefghij", clientSecret: "client-secret-abc", refreshToken: "1//refresh-token-abcdefgh", from: "me@example.com", testTo: "me@example.com" };

function gmailFetch(token: Response | (() => Response), send?: Response | Error) {
  const calls: string[] = [];
  const fetchFn = (async (u: string | URL) => {
    const url = String(u);
    calls.push(url.includes("oauth2") ? "token" : "send");
    if (url.includes("oauth2")) return typeof token === "function" ? token() : token.clone();
    if (send instanceof Error) throw send;
    return (send ?? json({ id: "gm-1", threadId: "t-1" })).clone();
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const tokenOk = (scope = SEND) => json({ access_token: "ya29.token", expires_in: 3599, scope });

describe("gmailChecks", () => {
  it("passes for a send-only token, reminds about the 7-day limit, and sends nothing unasked", async () => {
    const g = gmailFetch(tokenOk());
    const cs = await gmailChecks({ ...G, send: false, fetchFn: g.fetchFn });
    expect(by(cs, "token")).toMatchObject({ status: "pass", hint: expect.stringMatching(/7 days/) });
    expect(by(cs, "send")).toMatchObject({ status: "skip", detail: expect.stringContaining("me@example.com") });
    expect(g.calls).toEqual(["token"]);
  });

  it("warns about a broader scope than needed, and fails when the send scope is missing", async () => {
    expect(by(await gmailChecks({ ...G, send: false, fetchFn: gmailFetch(tokenOk(`${SEND} https://mail.google.com/`)).fetchFn }), "token")).toMatchObject({ status: "warn", detail: expect.stringContaining("https://mail.google.com/") });
    expect(by(await gmailChecks({ ...G, send: false, fetchFn: gmailFetch(tokenOk("https://www.googleapis.com/auth/gmail.readonly")).fetchFn }), "token")).toMatchObject({ status: "fail", detail: expect.stringContaining("does not carry the send scope") });
  });

  it("explains an expired token and a wrong OAuth client in plain words", async () => {
    expect(by(await gmailChecks({ ...G, send: false, fetchFn: gmailFetch(json({ error: "invalid_grant" }, 400)).fetchFn }), "token")).toMatchObject({ status: "fail", hint: expect.stringContaining("7 days") });
    expect(by(await gmailChecks({ ...G, send: false, fetchFn: gmailFetch(json({ error: "invalid_client" }, 401)).fetchFn }), "token")).toMatchObject({ status: "fail", hint: expect.stringContaining("GMAIL_CLIENT_ID") });
    expect(by(await gmailChecks({ ...G, send: false, fetchFn: gmailFetch(json({}, 503)).fetchFn }), "token")!.detail).toMatch(/HTTP 503/);
  });

  it("checks the addresses, and notes when they differ", async () => {
    expect(by(await gmailChecks({ ...G, from: "not an address", send: false, fetchFn: gmailFetch(tokenOk()).fetchFn }), "addresses")!.status).toBe("fail");
    expect(by(await gmailChecks({ ...G, testTo: "Me <me@example.com>", send: false, fetchFn: gmailFetch(tokenOk()).fetchFn }), "addresses")!.status).toBe("fail");
    expect(by(await gmailChecks({ ...G, testTo: "other@example.com", send: false, fetchFn: gmailFetch(tokenOk()).fetchFn }), "addresses")!.status).toBe("warn");
  });

  it("sends exactly one real test email, to the test address, when asked", async () => {
    const g = gmailFetch(tokenOk());
    const cs = await gmailChecks({ ...G, send: true, fetchFn: g.fetchFn });
    expect(by(cs, "send")).toMatchObject({ status: "pass", detail: expect.stringContaining("gm-1") });
    expect(g.calls.filter((c) => c === "send")).toHaveLength(1);
  });

  it("reports an uncertain send as a warning with the header to search for, and a refused send as a failure", async () => {
    const unknown = by(await gmailChecks({ ...G, send: true, fetchFn: gmailFetch(tokenOk(), new Response("{}", { status: 503 })).fetchFn }), "send")!;
    expect(unknown).toMatchObject({ status: "warn", hint: expect.stringMatching(/X-Outbound-Run: smoke-\d+/) });
    expect(by(await gmailChecks({ ...G, send: true, fetchFn: gmailFetch(tokenOk(), new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 })).fetchFn }), "send")!.status).toBe("fail");
  });

  it("never carries a credential in a check", async () => {
    const cs = await gmailChecks({ ...G, send: true, fetchFn: gmailFetch(json({ error: "invalid_grant", error_description: G.refreshToken }, 400)).fetchFn });
    const text = JSON.stringify(cs);
    for (const s of [G.clientSecret, G.refreshToken]) expect(text).not.toContain(s);
  });
});

// ================================================================ supabase
type Answers = Record<string, unknown[] | { error: string }>;
interface Rig {
  make: () => SbClient;
  worker: { email: string; password: string };
  logins: string[];
}

function sbRig(o: { anon?: Answers; worker?: Answers; rpc?: unknown; login?: boolean } = {}): Rig {
  const logins: string[] = [];
  const answers = (a: Answers) => (table: string) => {
    const hit = a[table];
    const result = hit && !Array.isArray(hit) ? { data: null, error: { message: hit.error } } : { data: (hit as unknown[]) ?? [], error: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.then = (f: (r: unknown) => unknown, r: (e: unknown) => unknown) => Promise.resolve(result).then(f, r);
    return q;
  };
  const make = (): SbClient => {
    let signed = false;
    return {
      auth: { signInWithPassword: async ({ email }: { email: string }) => (logins.push(email), o.login === false ? { error: { message: "Invalid login credentials" } } : ((signed = true), { error: null })) },
      from: (t: string) => ({ insert: () => answers({})(t) as never, select: () => answers(signed ? (o.worker ?? GOOD_WORKER) : (o.anon ?? { prospects: { error: "permission denied for table prospects" }, emails: { error: "permission denied" }, contacts: { error: "permission denied" }, settings_versions: { error: "permission denied" } }))(t) as never }),
      rpc: async () => {
        const r = o.rpc === undefined ? GOOD_SETTINGS : o.rpc;
        return r && typeof r === "object" && "error" in (r as object) ? { data: null, error: r as { message: string } } : { data: r, error: null };
      },
    } as unknown as SbClient;
  };
  return { make, worker: { email: "worker@example.com", password: "pw" }, logins };
}

const VERIFIED_FILE = { ...SPRINTO_FACTS_SEED, items: [{ ...SPRINTO_FACTS_SEED.items[0]!, verifiedBy: "Siddhant", verifiedAt: "2026-11-03" }] };
const GOOD_SETTINGS = { id: "s1", version: 2, test_to: "me@example.com", sender_name: "Sid", sender_title: "Growth Lead", postal_address: "1 Example Street" };
const GOOD_WORKER: Answers = { profiles: [{ role: "worker" }], icp_signoffs: [{ id: "x" }], sprinto_facts_versions: [{ content: VERIFIED_FILE }] };
const run = (r: Rig, over: Partial<Parameters<typeof supabaseChecks>[0]> = {}) => supabaseChecks({ make: r.make, worker: r.worker, testTo: "me@example.com", serviceKeyPresent: false, ...over });

describe("supabaseChecks", () => {
  it("passes for a project that is locked down and ready", async () => {
    const cs = await run(sbRig());
    expect(cs.filter((c) => c.status !== "pass").map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    expect(cs.map((c) => c.id)).toEqual(["service-key", "anon", "login", "role", "migrations", "test-address", "icp", "facts"]);
  });

  it("fails if a service-role key is in the environment", async () => {
    expect(by(await run(sbRig(), { serviceKeyPresent: true }), "service-key")).toMatchObject({ status: "fail", hint: expect.stringContaining("never uses the service role") });
  });

  it("fails if an anonymous visitor can read rows, naming the tables", async () => {
    const cs = await run(sbRig({ anon: { prospects: [{ id: "1" }], emails: [{ id: "2" }], contacts: { error: "permission denied" }, settings_versions: [] } }));
    expect(by(cs, "anon")).toMatchObject({ status: "fail", detail: expect.stringContaining("prospects, emails") });
  });

  it("stops after a refused worker login, without reading anything as the worker", async () => {
    const cs = await run(sbRig({ login: false }));
    expect(by(cs, "login")!.status).toBe("fail");
    expect(cs.map((c) => c.id)).toEqual(["service-key", "anon", "login"]);
  });

  it("fails if the worker has the wrong role, or can see other people's profiles", async () => {
    expect(by(await run(sbRig({ worker: { ...GOOD_WORKER, profiles: [{ role: "admin" }] } })), "role")!.status).toBe("fail");
    expect(by(await run(sbRig({ worker: { ...GOOD_WORKER, profiles: [{ role: "worker" }, { role: "viewer" }] } })), "role")!.status).toBe("fail");
  });

  it("fails, and stops, when the migrations are not applied", async () => {
    const cs = await run(sbRig({ rpc: { error: true, message: "function public.settings_now() does not exist" } }));
    expect(by(cs, "migrations")).toMatchObject({ status: "fail", hint: expect.stringContaining("supabase/migrations") });
    expect(by(cs, "icp")).toBeUndefined();
  });

  it("fails when the recorded test address and the server's differ, or when either is missing", async () => {
    expect(by(await run(sbRig(), { testTo: "other@example.com" }), "test-address")).toMatchObject({ status: "fail", detail: expect.stringContaining("nothing will send") });
    expect(by(await run(sbRig({ rpc: { ...GOOD_SETTINGS, test_to: null } })), "test-address")!.status).toBe("fail");
    expect(by(await run(sbRig(), { testTo: null }), "test-address")!.status).toBe("warn");
  });

  it("fails without a sign-off, and without a verified facts file, and judges the file by the sender in Settings as the worker does", async () => {
    expect(by(await run(sbRig({ worker: { ...GOOD_WORKER, icp_signoffs: [] } })), "icp")!.status).toBe("fail");
    const unverified = by(await run(sbRig({ worker: { ...GOOD_WORKER, sprinto_facts_versions: [{ content: SPRINTO_FACTS_SEED }] } })), "facts")!;
    expect(unverified).toMatchObject({ status: "fail", detail: expect.stringContaining("verified by a person") });
    const noSender = by(await run(sbRig({ rpc: { ...GOOD_SETTINGS, sender_name: "", postal_address: "" } })), "facts")!;
    expect(noSender.detail).toMatch(/sender|postal address/i);
  });
});

// ================================================================ dry run
describe("dryRun (a real company in a throwaway database)", () => {
  it("takes a good company all the way to the email it would have sent, with a stand-in contact and nothing mailed", async () => {
    const r = await dryRun({ domain: "https://www.Northwind.io/pricing", ai: demoAi(), fetchDeps: demoFetchDeps(), hunter: null });
    expect(r.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(by(r.checks, "end")).toMatchObject({ status: "pass" });
    expect(by(r.checks, "scrape")!.detail).toMatch(/6 pages/);
    expect(by(r.checks, "facts")!.detail).toMatch(/0 not found/);
    expect(by(r.checks, "score")!.title).toMatch(/Scored \d+\/100 \(qualified\)/);
    expect(by(r.checks, "email")!.detail).toMatch(/12 of 12 checks passed/);
    expect(r.email).toMatch(/^Subject: /);
    expect(r.email).toContain("Would have gone to: Sample Person, CTO at Northwind");
  });

  it("uses a real Hunter client when one is given", async () => {
    const r = await dryRun({ domain: "lumenhealth.com", ai: demoAi(), fetchDeps: demoFetchDeps(), hunter: demoHunter() });
    // At 11 to 50 people the ranker prefers the CEO over a head of security, as its size table says.
    expect(r.email).toContain("Would have gone to: Priya Nair, CEO at Lumen Health");
  });

  it("explains a company that does not qualify, as a warning and not a crash", async () => {
    const r = await dryRun({ domain: "vanta.com", ai: demoAi(), fetchDeps: demoFetchDeps(), hunter: null });
    expect(by(r.checks, "end")).toMatchObject({ status: "warn", title: expect.stringContaining("not_fit") });
    expect(r.email).toBeNull();
  });

  it("refuses a domain that is not a public company domain", async () => {
    const r = await dryRun({ domain: "10.0.0.1", ai: demoAi(), fetchDeps: demoFetchDeps(), hunter: null });
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0]).toMatchObject({ status: "fail" });
  });
});

// ================================================================ keys and the env file
describe("formatValue and the env file", () => {
  it("writes simple values plainly, quotes the rest, and refuses what it cannot write safely", () => {
    expect(formatValue("abc-123_./:@")).toBe("abc-123_./:@");
    expect(formatValue("has space")).toBe("'has space'");
    expect(formatValue("it's")).toBe('"it\'s"');
    expect(() => formatValue("both ' and \"")).toThrow(/both kinds of quote/);
    expect(() => formatValue("line\nbreak")).toThrow(/line break/);
    expect(() => formatValue("a\rb")).toThrow(/line break/);
    expect(() => formatValue("a\0b")).toThrow(/line break/);
    expect(() => formatValue("it's $HOME")).toThrow();
  });

  it("parses quotes, comments, export and inline comments", () => {
    expect(parseEnv("# c\nA=1\nexport B='x y'\nC=\"z\"\nD=plain # note\n\nbad line\nE=")).toEqual({ A: "1", B: "x y", C: "z", D: "plain", E: "" });
  });

  it("round-trips awkward values exactly through merge and parse", () => {
    const values = { A: "plain", B: "has space", C: "it's", D: "p@ss:w0rd/=+", E: "a#b" };
    expect(parseEnv(mergeEnv("", values))).toEqual(values);
  });

  it("updates in place, appends new keys, removes on empty, and keeps comments and order", () => {
    const before = "# keep me\nA=1\n\n# gemini\nB=old\nC=3\n";
    const after = mergeEnv(before, { B: "new value", D: "4", C: "" });
    expect(after).toBe("# keep me\nA=1\n\n# gemini\nB='new value'\nD=4\n");
    expect(mergeEnv(after, { D: "5" })).toContain("D=5");
    expect((mergeEnv(after, { D: "5" }).match(/^D=/gm) ?? []).length).toBe(1);
    expect(mergeEnv("", { A: "1" })).toBe("A=1\n");
  });

  it("refuses a value that would add a line, so a typed key cannot inject another variable", () => {
    expect(() => mergeEnv("A=1\n", { B: "x\nEVIL=1" })).toThrow(/line break/);
  });
});

describe("the key definitions", () => {
  const def = (n: string) => KEY_DEFS.find((k) => k.name === n)!;

  it("validates the shape of each kind of value, with a plain message", () => {
    expect(def("OUTBOUND_TEST_TO").validate!("me@example.com")).toBeNull();
    expect(def("OUTBOUND_TEST_TO").validate!("a@b.com, c@d.com")).toMatch(/plain email/);
    expect(def("NEXT_PUBLIC_SUPABASE_URL").validate!("https://abc.supabase.co")).toBeNull();
    expect(def("NEXT_PUBLIC_SUPABASE_URL").validate!("http://abc.supabase.co")).toMatch(/https/);
    expect(def("NEXT_PUBLIC_SUPABASE_URL").validate!("nope")).toMatch(/web address/);
    expect(def("GEMINI_API_KEY").validate!("short")).toMatch(/at least 20/);
    expect(def("GEMINI_API_KEY").validate!("has a space in it which is bad")).toMatch(/no spaces/);
    expect(def("GEMINI_MODEL").validate!("gemini-3.6-flash")).toBeNull();
    expect(def("GEMINI_MODEL").validate!("Not A Model")).toMatch(/model name/);
  });

  it("can generate a strong cron secret, different each time", () => {
    const a = def("CRON_SECRET").generate!();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(def("CRON_SECRET").generate!()).not.toBe(a);
    expect(def("CRON_SECRET").validate!(a)).toBeNull();
  });

  it("hides every credential while typing, and shows ordinary values", () => {
    for (const n of ["GEMINI_API_KEY", "HUNTER_API_KEY", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "WORKER_PASSWORD", "CRON_SECRET"]) expect(def(n).secret, n).toBe(true);
    for (const n of ["OUTBOUND_TEST_TO", "GMAIL_FROM", "APP_URL"]) expect(def(n).secret, n).toBe(false);
    expect(SECRET_NAMES).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("matches .env.local.example exactly, so the prompt and the documented file cannot drift", () => {
    const example = Object.keys(parseEnv(readFileSync(".env.local.example", "utf8"))).sort();
    expect(KEY_DEFS.map((k) => k.name).sort()).toEqual(example);
  });
});

describe("envChecks", () => {
  it("reports names only, never values, and says what is missing", () => {
    const cs = envChecks({ GEMINI_API_KEY: "SUPERSECRETVALUE123456", GMAIL_CLIENT_ID: "x".repeat(30) });
    const text = JSON.stringify(cs);
    expect(text).not.toContain("SUPERSECRETVALUE123456");
    expect(by(cs, "gemini")).toMatchObject({ status: "pass" });
    expect(by(cs, "supabase")).toMatchObject({ status: "warn", detail: expect.stringContaining("WORKER_PASSWORD") });
    expect(by(cs, "hunter")!.detail).toMatch(/not set \(optional\): HUNTER_API_KEY/);
  });

  it("fails if a service-role key is present", () => {
    expect(by(envChecks({ SUPABASE_SERVICE_ROLE_KEY: "whatever-value" }), "service-role")).toMatchObject({ status: "fail" });
    expect(by(envChecks({}), "service-role")).toBeUndefined();
  });
});
