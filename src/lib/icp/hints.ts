/**
 * What is already known about a company before its site is read, and how that is allowed to enter the score.
 *
 * Today that is one thing: the size band Hunter Discover found the company under. Sites rarely state their headcount, so
 * without it size is unknown and costs points or stops a company at "needs more". The rule that keeps this honest:
 *  - A size the site states, with a quote, always wins. A hint only fills in a size that is otherwise unknown.
 *  - The filled-in size is marked as coming from Hunter and given medium confidence, never high, so the score flags it as an
 *    estimate and the Why page says where it came from. It carries no quote, because there is none to give.
 * Pure, so each rule is tested.
 */

import type { Band, Facts } from "./types";
import { use } from "./score";

export const BANDS: Band[] = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];
const isBand = (s: unknown): s is Band => typeof s === "string" && (BANDS as string[]).includes(s);

export interface Hints {
  headcount?: Band;
}

export interface AppliedHint {
  kind: "headcount";
  value: Band;
  source: "hunter_discover";
  /** False when the site already stated the figure, so the hint was left unused. */
  used: boolean;
}

/** Reads the stored hint rows for one company. A row it does not understand is ignored. */
export function readHints(rows: { kind: string; value: string }[]): Hints {
  const h: Hints = {};
  for (const r of rows) if (r.kind === "headcount" && isBand(r.value)) h.headcount ??= r.value;
  return h;
}

export function applyHints(facts: Facts, hints: Hints): { facts: Facts; applied: AppliedHint[] } {
  if (!hints.headcount) return { facts, applied: [] };
  if (use(facts.headcount) !== null) return { facts, applied: [{ kind: "headcount", value: hints.headcount, source: "hunter_discover", used: false }] };
  return {
    facts: { ...facts, headcount: { value: hints.headcount, confidence: "medium", quotes: [], source: "hunter_discover" } },
    applied: [{ kind: "headcount", value: hints.headcount, source: "hunter_discover", used: true }],
  };
}

/**
 * Reads the hints a browser posts alongside a Discover run: a map of domain to band. Anything for a domain that is not in the
 * run, or with a band that does not exist, is dropped, so a malformed post cannot add a hint for something else.
 */
export function parseHintInput(raw: unknown, domains: string[]): { domain: string; kind: "headcount"; value: Band }[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const inRun = new Set(domains);
  return Object.entries(raw as Record<string, unknown>).flatMap(([domain, value]) => (inRun.has(domain) && isBand(value) ? [{ domain, kind: "headcount" as const, value }] : []));
}
