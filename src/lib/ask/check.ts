/**
 * Code checks an answer against what the lookups actually returned. The model writes the sentence; this finds the parts
 * of it that no lookup supports, so the page can say "check these" instead of presenting them as fact.
 *
 *  - Every domain the answer names must appear in a lookup result.
 *  - Every number must appear in a lookup result, or be the length of a list a result contained.
 */

const DOMAIN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}\b/gi;
const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?/g;

const norm = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");

/** Numbers that are the size of any array in the results, so "3 companies" is supported by a list of three. */
function listSizes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    into.add(String(value.length));
    for (const v of value) listSizes(v, into);
  } else if (value && typeof value === "object") for (const v of Object.values(value)) listSizes(v, into);
}

export interface Unsupported {
  domains: string[];
  numbers: string[];
}

export function unsupported(answer: string, results: unknown[]): Unsupported {
  const haystack = JSON.stringify(results).toLowerCase();
  const nums = new Set<string>();
  for (const m of JSON.stringify(results).matchAll(NUMBER)) nums.add(norm(m[0]));
  listSizes(results, nums);

  const domains = [...new Set((answer.match(DOMAIN) ?? []).map((d) => d.toLowerCase()))].filter((d) => !haystack.includes(d));
  // Ignore the digits inside a domain or a date-like token already judged above, and the number 1, which is ordinary speech.
  const stripped = answer.replace(DOMAIN, " ");
  const numbers = [...new Set((stripped.match(NUMBER) ?? []).map(norm))].filter((n) => n !== "1" && n !== "0" && !nums.has(n));
  return { domains, numbers };
}
