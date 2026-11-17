import { agentSystemPrompt, TOOLS, validateCall } from "@/lib/agent/loop";
import { TokenBudget } from "@/lib/ai/budget";
import { AiError } from "@/lib/ai/errors";
import { createGeminiClient, modelChain } from "@/lib/ai/gemini";
import { extractFacts, type ExtractPage } from "@/lib/extract/extract";
import { FACT_SPEC } from "@/lib/extract/spec";
import { createSite } from "@/lib/scrape/site";
import { demoFetchDeps } from "@/lib/demo/world";
import { fail, pass, safely, skip, warn, type Check } from "./report";

/**
 * Pins what the scope left open until a key existed: which model names are real, whether the JSON-schema mode accepts
 * `nullable` together with `enum`, whether function calling works, and whether the real model's answers survive the quote
 * check. A handful of small calls (the extraction is the largest), and each says what it cost in tokens.
 */

const S = "gemini";

export interface GeminiSmokeOptions {
  apiKey: string;
  /** GEMINI_MODEL, if the person pinned one. */
  pinned?: string;
  fetchFn?: typeof fetch;
}

/** The models the key can use, by name, from Gemini's own listing. */
export async function listModels(apiKey: string, fetchFn: typeof fetch = fetch): Promise<{ name: string; methods: string[] }[]> {
  const res = await fetchFn("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new AiError(res.status === 401 || res.status === 403 ? "auth" : "api_error");
  const body = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  return (body.models ?? []).map((m) => ({ name: String(m.name ?? "").replace(/^models\//, ""), methods: m.supportedGenerationMethods ?? [] })).filter((m) => m.name);
}

/** A real company's pages, made by the real scraper over the sample sites, so the extraction has something true to quote. */
export async function fixturePages(): Promise<ExtractPage[]> {
  const site = createSite("northwind.io", demoFetchDeps());
  await site.crawl();
  return site.pages().map((p) => ({ url: p.url, kind: p.kind, text: p.text }));
}

export async function geminiChecks(o: GeminiSmokeOptions): Promise<Check[]> {
  const fetchFn = o.fetchFn ?? fetch;
  const chain = modelChain({ GEMINI_MODEL: o.pinned });
  const out: Check[] = [];

  // 1. Which model names exist for this key?
  let listed: { name: string; methods: string[] }[] | null = null;
  out.push(
    ...(await safely(S, "list", "The key works and can list models", async () => {
      listed = await listModels(o.apiKey, fetchFn);
      const names = new Set(listed.map((m) => m.name));
      const missing = chain.filter((m) => !names.has(m));
      const flash = listed.filter((m) => /flash/i.test(m.name) && m.methods.includes("generateContent") && !/(image|tts|live|embedding|preview)/i.test(m.name)).map((m) => m.name).sort().reverse().slice(0, 4);
      if (missing.length === chain.length) return fail(S, "list", "The key works and can list models", `the key sees ${listed.length} models but none of ours (${chain.join(", ")})`, `Set GEMINI_MODEL to one of: ${flash.join(", ") || "(none listed)"}`);
      if (missing.length) return warn(S, "list", "The key works and can list models", `${listed.length} models listed. Not found: ${missing.join(", ")}`, `The chain skips a missing model, but update DEFAULT_MODELS. Available flash models: ${flash.join(", ")}`);
      return pass(S, "list", "The key works and can list models", `${listed.length} models listed, and all of ours exist (${chain.join(", ")})`);
    })),
  );
  if (out[0]?.status === "fail" && /refused the API key|Something went wrong/.test(out[0].detail)) return out;

  // 2. Which of them answer in JSON-schema mode?
  const working: string[] = [];
  for (const model of chain) {
    out.push(
      ...(await safely(S, `model:${model}`, `Model ${model} answers in JSON-schema mode`, async () => {
        const client = createGeminiClient({ apiKey: o.apiKey, models: [model], fetchFn });
        const res = await client.generateJson({ purpose: "smoke", system: "Reply with JSON only.", user: "Return ok as true.", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, temperature: 0, maxOutputTokens: 200, timeoutMs: 20_000 });
        if ((res.data as { ok?: unknown })?.ok !== true) return warn(S, `model:${model}`, `Model ${model} answers in JSON-schema mode`, `it answered, but not as asked (${JSON.stringify(res.data).slice(0, 60)})`);
        working.push(model);
        return pass(S, `model:${model}`, `Model ${model} answers in JSON-schema mode`, `${res.latencyMs} ms, ${res.usage.totalTokens} tokens`);
      })),
    );
  }
  if (working.length === 0) {
    out.push(fail(S, "chain", "At least one model works", "none of the models in the chain answered", "Read the errors above: each says whether it is the key, the account's billing, a usage limit or a model name. Nothing else can be checked until one model answers."));
    return out;
  }
  if (!working.includes(chain[0] as string)) out.push(warn(S, "chain", "The preferred model works", `${chain[0]} did not answer, so ${working[0]} will be used`, "Reorder DEFAULT_MODELS or pin GEMINI_MODEL."));
  const client = createGeminiClient({ apiKey: o.apiKey, models: working, fetchFn });

  // 3. The real extraction: the full schema (nullable + enum), the quote check, and the absence rules.
  out.push(
    ...(await safely(S, "extract", "Extraction works against the full schema", async () => {
      const pages = await fixturePages();
      const res = await extractFacts({ ai: client, pages, budget: new TokenBudget(60_000), timeoutMs: 40_000 });
      if (!res.ok) return fail(S, "extract", "Extraction works against the full schema", `${res.reason} (${res.code})`, res.code === "bad_json" ? "The schema may be too strict for this model. The scope flagged `nullable` together with `enum`: try a different model first." : undefined);
      const known = Object.values(res.facts).filter((f) => f.value !== null).length;
      const detail = `${known} of ${Object.keys(FACT_SPEC).length} facts known, ${res.grounding.checked} quotes checked, ${res.grounding.failures.length} not found on the page, ${res.problems.length} off-spec, ${res.usage.totalTokens} tokens`;
      if (res.problems.length || res.grounding.failures.length > 2) return warn(S, "extract", "Extraction works against the full schema", detail, `Off-spec: ${res.problems.slice(0, 3).join("; ") || "none"}. Not found: ${res.grounding.failures.join(", ") || "none"}.`);
      if (known < 6) return warn(S, "extract", "Extraction works against the full schema", detail, "Very few facts were read from a page that states them plainly. Look at the prompt.");
      return pass(S, "extract", "Extraction works against the full schema", `${detail}. Nullable with enum was accepted.`);
    })),
  );

  // 4. Function calling, kept in its own request.
  out.push(
    ...(await safely(S, "tools", "Function calling works", async () => {
      const turn = await client.generateTurn({
        purpose: "smoke",
        system: agentSystemPrompt(),
        contents: [{ role: "user", parts: [{ text: "Company domain: northwind.io\nStill unknown: enterprise signals; open security roles.\nPages already read: /.\nPages available to fetch: /pricing, /careers.\nChoose what to look at next." }] }],
        tools: TOOLS,
        temperature: 0.2,
        maxOutputTokens: 300,
        timeoutMs: 20_000,
      });
      if (turn.calls.length === 0) return warn(S, "tools", "Function calling works", `the model answered in text instead of calling a tool (${turn.finish})`, "The loop treats that as 'nothing to add'. Check the model supports function calling.");
      const valid = turn.calls.map((c) => ({ name: c.name, ok: validateCall(c.name, c.args).ok }));
      const bad = valid.filter((v) => !v.ok);
      return bad.length ? warn(S, "tools", "Function calling works", `called ${valid.map((v) => v.name).join(", ")} but ${bad.length} failed our argument check`, "The loop rejects those calls; that is the guard working, but note it.") : pass(S, "tools", "Function calling works", `called ${valid.map((v) => v.name).join(", ")} with arguments that passed our checks (${turn.usage.totalTokens} tokens)`);
    })),
  );
  return out;
}

export const geminiSkipped = (why: string): Check[] => [skip(S, "all", "Gemini", why, "Run `npm run keys` to enter GEMINI_API_KEY through a hidden prompt.")];
