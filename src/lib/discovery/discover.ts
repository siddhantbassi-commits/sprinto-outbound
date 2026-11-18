/**
 * Discovery, start to finish: three Hunter searches (one per angle), merged and ranked, each company's home page checked
 * before it is shown, and what is already known about it (researched, suppressed, mailed) said plainly. Nothing here spends a
 * Hunter credit (Discover is free) or a model token; the companies it returns are leads that still have to be read and
 * scored by the ICP before anyone is told they are a fit.
 */

import type { DiscoverCompany, HunterClient } from "@/lib/contacts/hunter";
import { HunterError } from "@/lib/contacts/hunter";
import { isExcludedDomain, DEFAULT_BLOCKLIST } from "@/lib/icp/blocklist";
import type { FetchDeps } from "@/lib/scrape/fetch";
import { ANGLES, angleRequest, mergeAngles, standingOf, type AngleId, type Candidate, type Criteria, type Standing } from "./criteria";
import { peekCompany, type Peek } from "./peek";

export interface Known {
  /** The ICP version's own extra blocklist, on top of the always-on competitors. */
  blocklist: string[];
  researched: Set<string>;
  suppressed: Set<string>;
  mailed: Set<string>;
}

export interface Found extends Candidate {
  standing: Standing;
  /** What the site says it does, in its own words. Empty when the page could not be read. */
  about: string;
  title: string;
  /** True when the home page was read and reads like a software company. False means it could not be checked, not that it is wrong. */
  verified: boolean;
  /** A reason worth showing: why it could not be verified. */
  note: string | null;
}

export interface Outcome {
  found: Found[];
  /** How many companies Hunter returned across the angles, before any filtering. */
  considered: number;
  /** How many each angle returned; null when that angle failed. */
  byAngle: Partial<Record<AngleId, number | null>>;
  problems: string[];
  /** Dropped after a look at the site, so the person knows the list was cleaned and by how much. */
  hidden: { notSoftware: number; unreachable: number };
}

export interface DiscoverDeps {
  hunter: HunterClient;
  fetchDeps: FetchDeps & { now?: () => Date };
  known: Known;
  /** Replaced in tests. */
  peek?: (domain: string) => Promise<Peek>;
  /** How many of the best new candidates to look at. Each is one page fetch. */
  peekLimit?: number;
  /** The longest to wait for any one site, so one slow page cannot hold the list up. */
  peekTimeoutMs?: number;
}

export const SHOWN_MAX = 30;
export const PEEK_LIMIT = 24;
const CONCURRENCY = 6;
const VERIFIED_BONUS = 3;
/** Companies that are not new are shown last, for information only, up to this many. */
const NOT_NEW_SHOWN = 6;

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => new Promise((resolve) => {
  const t = setTimeout(() => resolve(fallback), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
});

export async function discover(c: Criteria, deps: DiscoverDeps): Promise<Outcome> {
  if (!deps.hunter.discover) throw new HunterError("no_discover");
  const run = deps.hunter.discover.bind(deps.hunter);
  const exclude = [...DEFAULT_BLOCKLIST, ...deps.known.blocklist];

  const found: Partial<Record<AngleId, DiscoverCompany[]>> = {};
  const byAngle: Outcome["byAngle"] = {};
  const problems: string[] = [];
  let firstError: unknown = null;
  for (const angle of ANGLES.filter((a) => c.angles.includes(a.id))) {
    try {
      const res = await run(angleRequest(c, angle.id, exclude), 100);
      found[angle.id] = res.companies;
      byAngle[angle.id] = res.companies.length;
    } catch (e) {
      // A plan without Discover will fail every angle the same way, so say that and stop. Anything else fails one angle only.
      if (e instanceof HunterError && e.code === "no_discover") throw e;
      byAngle[angle.id] = null;
      firstError ??= e;
      problems.push(`${angle.label}: ${e instanceof Error ? e.message : "that search failed"}`);
    }
  }
  if (Object.values(byAngle).every((v) => v === null) && firstError) throw firstError;

  const merged = mergeAngles(found).filter((x) => !isExcludedDomain(x.domain, deps.known.blocklist));
  const withStanding = merged.map((x) => ({ x, standing: standingOf(x.domain, deps.known) }));
  const fresh = withStanding.filter((s) => s.standing === "new");
  const notNew = withStanding.filter((s) => s.standing !== "new");

  const peek = deps.peek ?? ((d: string) => peekCompany(d, deps.fetchDeps));
  const timeout = deps.peekTimeoutMs ?? 8_000;
  const unreadable: Peek = { reachable: false, reason: "The site took too long to answer.", title: "", about: "", looksLikeSoftware: false, signals: [] };
  const toLook = fresh.slice(0, deps.peekLimit ?? PEEK_LIMIT);
  const looks = await pool(toLook, CONCURRENCY, (s) => withTimeout(peek(s.x.domain), timeout, unreadable));

  const hidden = { notSoftware: 0, unreachable: 0 };
  const kept: Found[] = [];
  toLook.forEach((s, i) => {
    const p = looks[i] as Peek;
    if (!p.reachable) {
      hidden.unreachable += 1;
      return;
    }
    if (p.reason) {
      // Reachable but nothing to read (usually a page that needs JavaScript). It may be a fine company; say so and let a person choose.
      kept.push({ ...s.x, standing: s.standing, about: "", title: p.title, verified: false, note: "Could not be checked: the home page has very little readable text.", rank: s.x.rank });
      return;
    }
    if (!p.looksLikeSoftware) {
      hidden.notSoftware += 1;
      return;
    }
    kept.push({ ...s.x, standing: s.standing, about: p.about, title: p.title, verified: true, note: null, rank: s.x.rank + VERIFIED_BONUS });
  });
  kept.sort((a, b) => b.rank - a.rank || b.emailsTotal - a.emailsTotal || a.name.localeCompare(b.name));

  const informational: Found[] = notNew.slice(0, NOT_NEW_SHOWN).map((s) => ({ ...s.x, standing: s.standing, about: "", title: "", verified: false, note: null }));
  return { found: [...kept.slice(0, SHOWN_MAX), ...informational], considered: merged.length, byAngle, problems, hidden };
}
