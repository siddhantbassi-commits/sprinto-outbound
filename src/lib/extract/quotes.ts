import type { Facts } from "@/lib/icp/types";

/**
 * The grounding check. Gemini must support every fact with a verbatim quote; this proves each quote really appears in
 * the stored page text. A fact whose quotes cannot be found is reset to "unknown", so the model cannot invent evidence.
 */

const MIN_QUOTE_CHARS = 8;

/** Whitespace, case and curly-quote differences are not made-up evidence. */
export function normaliseText(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const buildCorpus = (pages: string[]): string[] => pages.map(normaliseText);

export function quoteInCorpus(quote: string, corpus: string[]): boolean {
  const q = normaliseText(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return corpus.some((page) => page.includes(q));
}

interface FactLike {
  value: unknown;
  confidence: string;
  quotes: string[];
}
const isFact = (x: unknown): x is FactLike =>
  typeof x === "object" && x !== null && "value" in x && "quotes" in x && Array.isArray((x as FactLike).quotes);

export interface GroundResult {
  facts: Facts;
  /** Facts that had a value but no quote that could be found, now reset to unknown. */
  failures: string[];
  checked: number;
}

/** Returns a copy of the facts with only verified quotes kept; unsupported facts become unknown. */
export function groundFacts(input: Facts, corpus: string[]): GroundResult {
  const facts = structuredClone(input) as unknown as Record<string, unknown>;
  const failures: string[] = [];
  let checked = 0;
  for (const [key, value] of Object.entries(facts)) {
    if (!isFact(value)) continue;
    if (value.value === null) {
      value.quotes = [];
      continue;
    }
    checked += 1;
    value.quotes = value.quotes.filter((q) => typeof q === "string" && quoteInCorpus(q, corpus));
    if (value.quotes.length === 0) {
      failures.push(key);
      value.value = null;
      value.confidence = "low";
    }
  }
  return { facts: facts as unknown as Facts, failures, checked };
}
