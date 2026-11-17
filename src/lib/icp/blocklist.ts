import { registrableDomain } from "@/lib/scrape/url-guard";

/**
 * Companies we never write to: Sprinto itself and its direct competitors. The ICP version can add more (an auditor, an
 * existing customer); this is the floor that is always on.
 */
export const DEFAULT_BLOCKLIST = [
  "sprinto.com", "vanta.com", "drata.com", "secureframe.com", "thoropass.com", "scrut.io", "laika.com", "hyperproof.io", "anecdotes.ai",
  "trustcloud.ai", "strikegraph.com", "cyberarrow.io", "auditboard.com", "onetrust.com", "trustarc.com",
];

export function isExcludedDomain(domain: string, extra: string[] = []): boolean {
  const mine = registrableDomain(domain.toLowerCase());
  return [...DEFAULT_BLOCKLIST, ...extra].some((d) => registrableDomain(d.toLowerCase().trim()) === mine);
}
