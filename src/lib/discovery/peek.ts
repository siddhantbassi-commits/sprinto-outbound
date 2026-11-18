/**
 * A quick look at a candidate's home page before it is shown: is the site real and reachable, does it read like a software
 * company, and what does it say it does? One polite page fetch (robots.txt obeyed, private addresses refused) and no model,
 * so it costs nothing but a second, and it keeps hotels, charities and dead domains out of the list. What it reports is the
 * site's own words, never a guess.
 */

import { createSite } from "@/lib/scrape/site";
import type { FetchDeps } from "@/lib/scrape/fetch";

export interface Peek {
  reachable: boolean;
  /** Why it could not be read, in words a person can use. */
  reason: string | null;
  title: string;
  /** What the site says about itself, taken from its own description or first strong line. */
  about: string;
  looksLikeSoftware: boolean;
  /** The software words found, so the judgement is explainable. */
  signals: string[];
}

const SOFTWARE_WORDS = ["saas", "software", "platform", "api", "cloud", "dashboard", "integrations", "integration", "sign in", "log in", "login", "free trial", "book a demo", "request a demo", "pricing", "developers", "developer", "open source", "workflow", "automation", "analytics"];
const STRONG = new Set(["saas", "software", "platform", "api", "cloud", "open source"]);
// Places that are the business itself. A hotel with a booking page is still a hotel.
const PLACES = /\b(hotel|resort|church|restaurant|dental|apartments?|golf|museum)\b/i;
// Sectors a software company sells to ("scheduling software for clinics"), so the word alone proves nothing: it only counts
// against a site that does not say "software", "platform", "api" and the like at least twice.
const SECTORS = /\b(school district|university|college|hospital|real estate|law firm|clinic)\b/i;

/** The first line that reads like a description: after the title, long enough to say something, short enough to be a sentence. */
export function aboutFrom(text: string, title: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const clean = (l: string) => l.replace(/^Page title:\s*/i, "").trim();
  const candidate = lines.find((l) => !/^Page title:/i.test(l) && l.length >= 50 && l.length <= 320 && clean(l).toLowerCase() !== title.toLowerCase()) ?? "";
  const out = candidate.replace(/\s+/g, " ");
  return out.length > 220 ? `${out.slice(0, 217).trimEnd()}…` : out;
}

export function readPeek(text: string, title: string): Omit<Peek, "reachable" | "reason"> {
  const lower = text.toLowerCase();
  const signals = SOFTWARE_WORDS.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, "\\s+")}([^a-z]|$)`).test(lower));
  const strong = signals.filter((s) => STRONG.has(s)).length;
  const head = `${title}\n${text.slice(0, 1500)}`;
  // Enough different software words, or two of the strong ones; and a hotel with a booking login does not count.
  const looksLikeSoftware = (signals.length >= 4 || strong >= 2) && !(PLACES.test(head) && signals.length < 6) && !(SECTORS.test(head) && strong < 2);
  return { title: title.replace(/\s+/g, " ").trim().slice(0, 120), about: aboutFrom(text, title), looksLikeSoftware, signals: signals.slice(0, 8) };
}

export async function peekCompany(domain: string, deps: FetchDeps & { now?: () => Date }): Promise<Peek> {
  try {
    const site = createSite(domain, deps);
    // The same first move the crawler makes: the home page over https, then plain http if the connection itself failed.
    let out = await site.fetchUrl(`https://${domain}/`);
    if (!out.ok && /connect|closed|refused|timed? ?out|No full response/i.test(out.reason)) out = await site.fetchUrl(`http://${domain}/`);
    if (!out.ok) return { reachable: false, reason: out.reason, title: "", about: "", looksLikeSoftware: false, signals: [] };
    if (out.page.thin) return { reachable: true, reason: "The home page has very little text to read (it may need JavaScript).", title: out.page.title, about: "", looksLikeSoftware: false, signals: [] };
    return { reachable: true, reason: null, ...readPeek(out.page.text, out.page.title) };
  } catch {
    return { reachable: false, reason: "The site could not be read.", title: "", about: "", looksLikeSoftware: false, signals: [] };
  }
}
