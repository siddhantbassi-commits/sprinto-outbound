import { use } from "@/lib/icp/score";
import type { Facts } from "@/lib/icp/types";
import { normaliseText } from "@/lib/extract/quotes";

/**
 * The things the email may open with: verified quotes from the company's own pages, each with the page it came from.
 * The model picks one by id; it cannot supply a hook of its own, so every hook is real text on a real page.
 */

export interface HookOption {
  id: string;
  quote: string;
  /** The page whose text contains the quote. */
  source: string | null;
  fact: string;
}

const RANK = { high: 2, medium: 1, low: 0 } as const;

/**
 * `preferred` is in order of priority: a quote earlier in the list is offered before one later in it, and any preferred quote
 * before one that is not. The model chooses among what it is shown and tends to take the first, so the order is how the
 * strongest real signal gets to lead the email.
 */
export function hookOptions(facts: Facts, pages: { url: string; text: string }[], preferred: string[] = [], max = 6): HookOption[] {
  const order = new Map<string, number>();
  preferred.forEach((q, i) => {
    const n = normaliseText(q);
    if (!order.has(n)) order.set(n, i);
  });
  const normalised = pages.map((p) => ({ url: p.url, text: normaliseText(p.text) }));
  const seen = new Set<string>();
  const found: (HookOption & { rank: number })[] = [];
  for (const [key, fact] of Object.entries(facts)) {
    const f = fact as { value: unknown; confidence: "high" | "medium" | "low"; quotes: string[] };
    if (use(f as never) === null) continue;
    for (const quote of f.quotes) {
      const n = normaliseText(quote);
      if (seen.has(n)) continue;
      const page = normalised.find((p) => p.text.includes(n));
      if (!page) continue; // a quote that is not on any stored page is never offered
      seen.add(n);
      found.push({ id: "", quote, source: page.url, fact: key, rank: (order.has(n) ? 1000 - (order.get(n) as number) : 0) + RANK[f.confidence] });
    }
  }
  found.sort((a, b) => b.rank - a.rank || a.fact.localeCompare(b.fact));
  return found.slice(0, max).map(({ rank: _rank, ...h }, i) => ({ ...h, id: `H${i + 1}` }));
}

/** Every verified quote in the facts, for the lint's "did we really use that source" check. */
export function allQuotes(facts: Facts): string[] {
  return Object.values(facts).flatMap((f) => (f as { quotes: string[] }).quotes);
}
