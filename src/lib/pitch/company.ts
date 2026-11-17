import { registrableDomain } from "@/lib/scrape/url-guard";

/**
 * The name the email uses for the company. We never ask the model: it comes from the home page's title when that
 * contains the domain's own name, and otherwise from the domain itself. Lint check L3 then requires the draft to use it.
 */

const SEPARATORS = /\s*[|·•–—:]\s*|\s+-\s+/;
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

export function companyName(domain: string, homeTitle: string | null): string {
  const label = registrableDomain(domain).split(".")[0] ?? domain;
  const key = compact(label);
  if (homeTitle && key.length >= 3) {
    const hits = homeTitle
      .split(SEPARATORS)
      .map(clean)
      .filter((seg) => seg.length > 0 && seg.length <= 40 && compact(seg).includes(key));
    hits.sort((a, b) => a.length - b.length);
    if (hits[0]) return hits[0];
  }
  return clean(label.replace(/-+/g, " ")).replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 40) || domain;
}
