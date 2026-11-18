/**
 * Finding companies that fit Sprinto, before anyone pastes a list. The ICP says what a good customer looks like; this turns
 * that into explicit Hunter filters (a loose plain-English query reads "enterprise" as "huge" and returns Infosys), runs them
 * as three separate angles, and ranks the companies by how many angles agree. Pure, so every rule is tested.
 *
 * What it can and cannot know: Hunter's data is a lead, not a verdict. A company only counts as a fit after its own site has
 * been read and scored by the ICP, exactly as for a pasted list. Discovery only decides who is worth reading.
 */

import type { IcpConfig } from "@/lib/icp/config";
import type { DiscoverCompany } from "@/lib/contacts/hunter";

export const REGIONS = [
  { id: "AMER", label: "North America" },
  { id: "EMEA", label: "Europe, Middle East and Africa" },
  { id: "APAC", label: "Asia-Pacific" },
  { id: "LATAM", label: "Latin America" },
] as const;
export type RegionId = (typeof REGIONS)[number]["id"];

export const SIZES = [
  { id: "1-10", label: "1 to 10" },
  { id: "11-50", label: "11 to 50" },
  { id: "51-200", label: "51 to 200" },
  { id: "201-500", label: "201 to 500" },
  { id: "501-1000", label: "501 to 1,000" },
] as const;
export type SizeId = (typeof SIZES)[number]["id"];

export type AngleId = "hiring" | "software" | "regulated";

export interface AngleDef {
  id: AngleId;
  label: string;
  /** Said to the user beside each company, so the reason for a suggestion is never a mystery. */
  because: string;
  /** Why this signal matters to Sprinto, for the criteria panel. */
  help: string;
}

export const ANGLES: AngleDef[] = [
  { id: "hiring", label: "Hiring for security or compliance", because: "Hiring for a security, compliance or privacy role in the last 90 days", help: "The strongest buying signal: a company hiring its first compliance owner is feeling the pain right now." },
  { id: "software", label: "B2B software (SaaS)", because: "A B2B software company", help: "Sprinto automates SOC 2, ISO 27001 and GDPR for SaaS companies, so this is the core market." },
  { id: "regulated", label: "Regulated or data-heavy markets", because: "Operates in a regulated or data-heavy sector (fintech, health, payments, insurance)", help: "Customers in these sectors ask for security reports early, so the need comes sooner." },
];

export interface Criteria {
  regions: RegionId[];
  sizes: SizeId[];
  angles: AngleId[];
  /** How many companies the person wants to research from this search. */
  want: number;
}

export const MAX_WANT = 25;
export const DEFAULT_WANT = 10;

/** The sizes the ICP scores well (6 points or more), and the regions Sprinto sells into, as a starting point. */
export function defaultCriteria(icp: IcpConfig): Criteria {
  const size = icp.points.size as Record<string, number>;
  const sizes = SIZES.map((s) => s.id).filter((id) => (size[id] ?? 0) >= 6);
  return { regions: ["AMER", "EMEA"], sizes: sizes.length ? sizes : ["11-50", "51-200", "201-500"], angles: ["hiring", "software", "regulated"], want: DEFAULT_WANT };
}

const pick = <T extends string>(raw: unknown, allowed: readonly T[]): T[] => (Array.isArray(raw) ? [...new Set(raw.filter((x): x is T => typeof x === "string" && (allowed as readonly string[]).includes(x)))] : []);

/** Whatever the browser posts is shape-checked here; anything unknown is dropped and a missing list falls back to the default. */
export function normaliseCriteria(raw: unknown, fallback: Criteria): Criteria {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const regions = pick(o.regions, REGIONS.map((r) => r.id));
  const sizes = pick(o.sizes, SIZES.map((s) => s.id));
  const angles = pick(o.angles, ANGLES.map((a) => a.id));
  const want = typeof o.want === "number" && Number.isFinite(o.want) ? Math.min(MAX_WANT, Math.max(1, Math.trunc(o.want))) : fallback.want;
  return { regions: regions.length ? regions : fallback.regions, sizes: sizes.length ? sizes : fallback.sizes, angles: angles.length ? angles : fallback.angles, want };
}

const NOT_COMPANIES = ["educational", "educational institution", "government agency", "non profit", "self employed", "sole proprietorship"];
const SECURITY_TITLES = ["information security", "security engineer", "security analyst", "compliance", "grc", "ciso", "devsecops", "privacy", "risk"];
const REGULATED_WORDS = ["fintech", "healthtech", "health", "healthcare", "payments", "banking", "insurance", "compliance", "security"];
export const HUNTER_EXCLUDE_LIMIT = 100;

/**
 * One Hunter request per angle. Filters are ANDed by Hunter, so every angle is narrowed to software companies; without that,
 * "hiring a security role" finds hotels, universities and charities (a guard is a security role too).
 */
export function angleRequest(c: Criteria, angle: AngleId, excludeDomains: string[], band?: SizeId): Record<string, unknown> {
  const body: Record<string, unknown> = {
    headquarters_location: { include: c.regions.map((r) => ({ business_region: r })) },
    // Hunter does not say which size a company is in, only that it matched the filter. Asking for one band at a time is how
    // a company's band is known, so the search is run once per chosen band and each company is tagged with the one it came from.
    headcount: band ? [band] : c.sizes,
    company_type: { exclude: NOT_COMPANIES },
    industry: { include: ["Software Development"] },
  };
  if (excludeDomains.length) body.organization = { exclude: { domain: excludeDomains.slice(0, HUNTER_EXCLUDE_LIMIT) } };
  if (angle === "hiring") body.job_openings = { job_title: { include: SECURITY_TITLES }, posted_date: "last90d" };
  else if (angle === "software") body.keywords = { include: ["saas", "software as a service", "b2b"], match: "any" };
  else body.keywords = { include: REGULATED_WORDS, match: "any" };
  return body;
}

export interface Candidate {
  domain: string;
  name: string;
  emailsTotal: number;
  /** The size band Hunter found it under, or null when two bands both claimed it (so it is not known). */
  band: SizeId | null;
  /** Every angle that found this company. More agreement, better lead. */
  angles: AngleId[];
  /** Why it was suggested, in plain words. */
  because: string[];
  /** Higher is better. Only used to order the list. */
  rank: number;
}

const HIRING_BONUS = 6;
const PER_ANGLE = 10;

/** A company Hunter holds addresses for can probably be given a named contact, so it is worth a little more. */
const contactBonus = (emails: number) => (emails <= 0 ? 0 : Math.min(4, Math.round(Math.log2(1 + emails))));

export function mergeAngles(found: Partial<Record<AngleId, DiscoverCompany[]>>): Candidate[] {
  const claimed = new Map<string, Set<SizeId>>();
  for (const def of ANGLES) for (const co of found[def.id] ?? []) if (co.band) claimed.set(co.domain, (claimed.get(co.domain) ?? new Set()).add(co.band as SizeId));
  const byDomain = new Map<string, Candidate>();
  for (const def of ANGLES) {
    for (const co of found[def.id] ?? []) {
      const have = byDomain.get(co.domain);
      if (have) {
        if (!have.angles.includes(def.id)) {
          have.angles.push(def.id);
          have.because.push(def.because);
        }
        have.emailsTotal = Math.max(have.emailsTotal, co.emailsTotal);
      } else byDomain.set(co.domain, { domain: co.domain, name: co.name, emailsTotal: co.emailsTotal, band: null, angles: [def.id], because: [def.because], rank: 0 });
    }
  }
  const out = [...byDomain.values()];
  for (const c of out) {
    const bands = claimed.get(c.domain);
    c.band = bands && bands.size === 1 ? [...bands][0]! : null;
  }
  for (const c of out) c.rank = c.angles.length * PER_ANGLE + (c.angles.includes("hiring") ? HIRING_BONUS : 0) + contactBonus(c.emailsTotal);
  return out.sort((a, b) => b.rank - a.rank || b.emailsTotal - a.emailsTotal || a.name.localeCompare(b.name));
}

/** Where a suggested company already stands, so it is shown with a reason instead of silently missing. */
export type Standing = "new" | "researched" | "suppressed" | "mailed_recently";

/**
 * Which suggestions can be chosen for research. A company already researched can be read again on purpose (its size may now
 * be known, or its site may have changed), but one on the do-not-contact list, or mailed inside the cooldown, never can.
 */
export const canResearch = (s: Standing): boolean => s === "new" || s === "researched";

export const STANDING_NOTE: Record<Standing, string> = {
  new: "",
  researched: "Researched before: choosing it reads it again",
  suppressed: "On the do-not-contact list",
  mailed_recently: "Mailed in the last 30 days",
};

export function standingOf(domain: string, known: { researched: Set<string>; suppressed: Set<string>; mailed: Set<string> }): Standing {
  if (known.suppressed.has(domain)) return "suppressed";
  if (known.mailed.has(domain)) return "mailed_recently";
  if (known.researched.has(domain)) return "researched";
  return "new";
}

/**
 * A rough, honest cost of reading n companies, from real runs: about 16,000 tokens and 40 seconds a company on average
 * (about 25 seconds to be read and scored, and a further 35 for the ones that qualify and are drafted). The worker takes
 * companies one after another, so the time adds up rather than overlapping.
 */
export const COST_PER_COMPANY = { tokens: 16_000, seconds: 40 } as const;
export function estimateCost(n: number): { tokens: number; minutes: number } {
  return { tokens: n * COST_PER_COMPANY.tokens, minutes: Math.max(1, Math.ceil((n * COST_PER_COMPANY.seconds) / 60)) };
}
