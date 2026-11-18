"use server";
import { currentSettings } from "@/lib/app/queries";
import { loadKnown } from "@/lib/app/known";
import { discoverySetup, getSession, hunterBalance } from "@/lib/app/runtime";
import { HunterError } from "@/lib/contacts/hunter";
import { defaultCriteria, normaliseCriteria, type Criteria } from "@/lib/discovery/criteria";
import { discover, type Outcome } from "@/lib/discovery/discover";
import { ICP_V1 } from "@/lib/icp/config";
import { GUEST_MAX_PER_RUN } from "@/lib/app/guest";

export interface SearchResult {
  ok: boolean;
  message?: string;
  criteria?: Criteria;
  outcome?: Outcome;
  hunter?: { remaining: number; reserve: number } | null;
  maxRun?: number | null;
  tookMs?: number;
}

/**
 * Finds companies that look like Sprinto customers. Free (Hunter's Discover costs no credit) and uses no model; every company
 * it returns is only a lead until its own site has been read and scored in a run.
 */
export async function searchCompanies(_prev: SearchResult | null, formData: FormData): Promise<SearchResult> {
  const s = await getSession();
  if (!s || (s.user.role !== "operator" && s.user.role !== "admin")) return { ok: false, message: "Only an operator or admin can search for companies." };
  const setup = discoverySetup();
  if (!setup.ok) return { ok: false, message: setup.reason };

  let raw: unknown = null;
  try {
    raw = JSON.parse(String(formData.get("criteria") ?? "null"));
  } catch {
    /* an unreadable form falls back to the defaults */
  }
  const criteria = normaliseCriteria(raw, defaultCriteria(ICP_V1));
  const settings = await currentSettings(s.db);
  const started = Date.now();
  try {
    const known = await loadKnown(s.db, settings?.mail_cooldown_days ?? 30);
    const outcome = await discover(criteria, { hunter: setup.hunter, fetchDeps: setup.fetchDeps, known });
    const balance = await hunterBalance();
    return {
      ok: true,
      criteria,
      outcome,
      hunter: balance && balance.remaining !== undefined ? { remaining: balance.remaining, reserve: Math.max(settings?.hunter_reserve ?? 3, s.guest ? (s.env.guest?.keepCredits ?? 0) : 0) } : null,
      // A guest run holds at most GUEST_MAX_PER_RUN companies, so the form preselects no more than that.
      maxRun: s.guest ? Math.min(settings?.max_run_size ?? GUEST_MAX_PER_RUN, GUEST_MAX_PER_RUN) : (settings?.max_run_size ?? null),
      tookMs: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, criteria, message: e instanceof HunterError || e instanceof Error ? e.message : "The search failed." };
  }
}
