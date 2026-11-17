import { TokenBudget, estimateTokens } from "@/lib/ai/budget";
import { AiError, type AiErrorCode } from "@/lib/ai/errors";
import { UNTRUSTED_NOTICE, newDelimiter, scanInjection, wrapUntrusted, type InjectionScan } from "@/lib/ai/untrusted";
import { NO_USAGE, addUsage, type AiClient, type Usage } from "@/lib/ai/types";
import type { Facts } from "@/lib/icp/types";
import { applyAbsences, type PageText } from "./absence";
import { buildCorpus, groundFacts } from "./quotes";
import { FACT_SPEC, MAX_QUOTES, MAX_QUOTE_CHARS, factsSchema, parseFacts } from "./spec";

/**
 * Step 2. Gemini reads the stored pages and returns the facts with quotes; code then holds it to the evidence:
 * schema check, quote-in-page check, absence rules. Whatever fails becomes "unknown", never a guess.
 */

export const EXTRACT_PROMPT_VERSION = "extract-v1";

const PAGE_CHAR_CAP = 24_000;
const TOTAL_CHAR_CAP = 90_000;
const MAX_OUTPUT_TOKENS = 4096;
const KIND_ORDER = ["home", "pricing", "security", "about", "customers", "careers", "other"];

export interface ExtractPage extends PageText {
  url: string;
}

export function extractSystemPrompt(): string {
  return [
    "You extract structured facts about ONE company from text copied from its own website. You are a careful reader, not a guesser.",
    "",
    "Rules:",
    "1. Use only the provided page text. Never fill a gap from what you remember about the company or the industry.",
    "2. For every field return value, confidence (high, medium or low) and quotes.",
    `3. quotes are 1 to ${MAX_QUOTES} passages copied EXACTLY, character for character, from the page text, each at most ${MAX_QUOTE_CHARS} characters, that support the value. A quote must be something a reader could find with Ctrl+F. Do not paraphrase, join separate sentences or fix typos.`,
    "4. If the text does not say, set value to null, confidence to low and quotes to an empty list. Null is a correct and useful answer.",
    "5. Exceptions: compliance 'none_visible', complianceVendor 'none' and securityHiring 'none' say that something is absent. They have no quote. Use them only when the relevant pages were provided and show nothing. Code will check the claim.",
    "6. Use high confidence only when the text states it plainly. Use medium for a reasonable reading of clear text, and low for anything weaker.",
    "",
    UNTRUSTED_NOTICE,
    "",
    "Fields:",
    ...Object.entries(FACT_SPEC).map(([key, spec]) => `- ${key}: ${spec.help}`),
  ].join("\n");
}

/** The pages in the order that matters, each capped, the total capped. Returned with how much was sent, for the trace. */
export function buildUserPrompt(pages: ExtractPage[], token: string): { prompt: string; sentChars: number; truncated: boolean } {
  const ordered = [...pages].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  let total = 0;
  let truncated = false;
  const blocks: string[] = [];
  for (const p of ordered) {
    const room = TOTAL_CHAR_CAP - total;
    if (room <= 500) {
      truncated = true;
      break;
    }
    const slice = p.text.slice(0, Math.min(PAGE_CHAR_CAP, room));
    if (slice.length < p.text.length) truncated = true;
    total += slice.length;
    blocks.push(wrapUntrusted(`${p.kind} page: ${p.url}`, slice, token));
  }
  const prompt = `Here are the pages of the company's website.\n\n${blocks.join("\n\n")}\n\nReturn the facts as JSON.`;
  return { prompt, sentChars: total, truncated };
}

export interface ExtractOk {
  ok: true;
  facts: Facts;
  grounding: { checked: number; failures: string[] };
  absences: { derived: string[]; rejected: string[] };
  /** Off-spec parts of the model's answer that were turned into unknown. */
  problems: string[];
  injection: { url: string; scan: InjectionScan }[];
  usage: Usage;
  calls: number;
  model: string;
  promptVersion: string;
  truncated: boolean;
}
export interface ExtractFail {
  ok: false;
  code: AiErrorCode | "no_pages";
  reason: string;
  usage: Usage;
  calls: number;
}

export interface ExtractInput {
  ai: AiClient;
  pages: ExtractPage[];
  budget: TokenBudget;
  timeoutMs?: number;
}

export async function extractFacts({ ai, pages, budget, timeoutMs = 30_000 }: ExtractInput): Promise<ExtractOk | ExtractFail> {
  if (pages.length === 0) return { ok: false, code: "no_pages", reason: "There are no pages to read.", usage: NO_USAGE, calls: 0 };

  const token = newDelimiter();
  const { prompt, truncated } = buildUserPrompt(pages, token);
  const system = extractSystemPrompt();
  const injection = pages.map((p) => ({ url: p.url, scan: scanInjection(p.text) })).filter((x) => x.scan.flagged);

  let usage: Usage = NO_USAGE;
  let calls = 0;
  let lastError: AiError = new AiError("api_error");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      budget.assertRoom(estimateTokens(system) + estimateTokens(prompt) + MAX_OUTPUT_TOKENS);
    } catch (e) {
      return { ok: false, code: "budget", reason: (e as AiError).message, usage, calls };
    }
    try {
      calls += 1;
      const res = await ai.generateJson({ purpose: "extract", system, user: prompt, schema: factsSchema(), temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs });
      usage = addUsage(usage, res.usage);
      budget.charge(res.usage);

      const parsed = parseFacts(res.data);
      const corpus = buildCorpus(pages.map((p) => p.text));
      const grounded = groundFacts(parsed.facts, corpus);
      const absence = applyAbsences(parsed.facts, grounded.facts, pages);
      // An absence is not a quote failure: it never had one to find.
      const failures = grounded.failures.filter((k) => !absence.derived.includes(k) && !absence.rejected.includes(k));
      return {
        ok: true,
        facts: absence.facts,
        grounding: { checked: grounded.checked, failures },
        absences: { derived: absence.derived, rejected: absence.rejected },
        problems: parsed.problems,
        injection,
        usage,
        calls,
        model: res.model,
        promptVersion: EXTRACT_PROMPT_VERSION,
        truncated,
      };
    } catch (e) {
      lastError = e instanceof AiError ? e : new AiError("api_error");
      if (!lastError.retryable) break;
    }
  }
  return { ok: false, code: lastError.code, reason: lastError.message, usage, calls };
}
