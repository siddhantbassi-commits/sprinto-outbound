import { HunterError, type HunterClient } from "./hunter";
import type { HunterBudget } from "./quota";
import type { Candidate } from "./rank";

/**
 * Step 4's lookup order: a manual contact, else the 30-day cache, else one Hunter call if the credits allow, else the
 * review lane. Every outcome says which it was and why, so the Why page never has to guess. A contact's email stays
 * inside this module's result; nothing here talks to the model.
 */

export const CACHE_TTL_MS = 30 * 24 * 3_600_000;

export interface CachedSearch {
  candidates: Candidate[];
  fetchedAt: number;
}

export interface ContactCache {
  get(domain: string): Promise<CachedSearch | null>;
  set(domain: string, value: CachedSearch): Promise<void>;
}

export function memoryCache(): ContactCache & { size: number } {
  const map = new Map<string, CachedSearch>();
  return {
    get size() {
      return map.size;
    },
    async get(domain) {
      return map.get(domain) ?? null;
    },
    async set(domain, value) {
      map.set(domain, structuredClone(value));
    },
  };
}

export type FindSource = "manual" | "cache" | "hunter" | "none";
export type NoneReason = "budget" | "no_results" | "hunter_error" | "quota_exhausted";

export interface FindResult {
  source: FindSource;
  candidates: Candidate[];
  /** Why there is nothing, when source is "none". */
  reason?: NoneReason;
  creditsSpent: number;
  /** When a cached result was fetched. */
  cachedAt?: number;
  detail: string;
}

export interface FindDeps {
  hunter: HunterClient;
  budget: HunterBudget;
  cache: ContactCache;
  now?: () => number;
}

export async function findCandidates(domain: string, manual: Candidate[], deps: FindDeps): Promise<FindResult> {
  const now = (deps.now ?? Date.now)();
  const mine = manual.filter((c) => c.source === "manual");
  if (mine.length > 0) {
    return { source: "manual", candidates: mine, creditsSpent: 0, detail: `${mine.length} hand-picked contact${mine.length === 1 ? "" : "s"}; Hunter not used.` };
  }

  const cached = await deps.cache.get(domain);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    const age = Math.floor((now - cached.fetchedAt) / 86_400_000);
    return {
      source: cached.candidates.length > 0 ? "cache" : "none",
      candidates: cached.candidates,
      ...(cached.candidates.length === 0 ? { reason: "no_results" as const } : {}),
      creditsSpent: 0,
      cachedAt: cached.fetchedAt,
      detail: `Hunter result from ${age} day${age === 1 ? "" : "s"} ago; no credit used.`,
    };
  }

  try {
    if (!(await deps.budget.canSpend(1))) {
      const snap = await deps.budget.snapshot();
      return { source: "none", candidates: [], reason: "budget", creditsSpent: 0, detail: `Hunter has ${snap.remaining} credits left and ${deps.budget.reserve} are kept in reserve.` };
    }
    const result = await deps.hunter.domainSearch(domain);
    deps.budget.record(result.creditsUsed);
    await deps.cache.set(domain, { candidates: result.candidates, fetchedAt: now });
    if (result.candidates.length === 0) {
      return { source: "none", candidates: [], reason: "no_results", creditsSpent: result.creditsUsed, detail: "Hunter found no senior contacts for this domain." };
    }
    return { source: "hunter", candidates: result.candidates, creditsSpent: result.creditsUsed, detail: `${result.candidates.length} candidate${result.candidates.length === 1 ? "" : "s"} from Hunter (${result.total} on file).` };
  } catch (e) {
    if (e instanceof HunterError && e.code === "quota") {
      deps.budget.markExhausted();
      return { source: "none", candidates: [], reason: "quota_exhausted", creditsSpent: 0, detail: e.message };
    }
    return { source: "none", candidates: [], reason: "hunter_error", creditsSpent: 0, detail: e instanceof HunterError ? e.message : "Hunter could not be reached." };
  }
}
