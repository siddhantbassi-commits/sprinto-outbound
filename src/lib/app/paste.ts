/**
 * A friendly first pass over whatever a person pastes, run in the browser while they type. It pulls company domains out of
 * messy text (a list copied from a spreadsheet, an email thread, a web page) and says what it did, so nobody has to tidy a
 * list by hand. It is a convenience only: it needs no network and imports nothing from the server, and the server check
 * (`parseList` plus the database) still decides what is allowed to run.
 */

export interface Cleaned {
  /** One per company, lower case, no www, in the order first seen. */
  domains: string[];
  /** Domains taken from the part after the @ of an email address. */
  fromEmails: number;
  /** Repeats that were folded together. */
  duplicates: number;
  /** Things that looked like a web address but could not be one, so the person can see what was dropped. */
  unclear: string[];
  /** The text has a header row naming a column, so the server will read that column. */
  csv: boolean;
}

const HEADER = /^(domain|domains|website|websites|url|urls|site|company website|company domain|web)$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const EDGE = /^[\s<>()[\]{}"'`.,;:!?|*•·–—-]+|[\s<>()[\]{}"'`.,;:!?|*•·–—-]+$/g;

/** Splits one CSV line, honouring double quotes. Good enough for a list of domains, not a general CSV parser. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] as string;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out;
}

/** One token to a bare host, or null when it is not a candidate at all (a plain word such as a company name). */
function toHost(token: string): { host: string; email: boolean } | { unclear: string } | null {
  let t = token.replace(EDGE, "");
  if (!t) return null;
  t = t.replace(/^mailto:/i, "");
  let email = false;
  if (t.includes("@")) {
    t = t.slice(t.lastIndexOf("@") + 1);
    email = true;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(t);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1] as string)) return { unclear: token.slice(0, 80) };
    t = t.slice(scheme[0].length);
  }
  t = (t.split(/[/?#]/)[0] ?? "").replace(/:\d{1,5}$/, "").toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!t.includes(".")) return scheme || email ? { unclear: token.slice(0, 80) } : null;
  return DOMAIN.test(t) ? { host: t, email } : { unclear: token.slice(0, 80) };
}

export function cleanPaste(raw: string): Cleaned {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ? splitCsvLine(lines[0]).map((c) => c.trim()) : [];
  const column = first.findIndex((c) => HEADER.test(c));
  const csv = column >= 0;
  const body = csv ? lines.slice(1) : lines;

  const seen = new Set<string>();
  const out: Cleaned = { domains: [], fromEmails: 0, duplicates: 0, unclear: [], csv };
  for (const line of body) {
    const tokens = csv ? [splitCsvLine(line)[column] ?? ""] : line.split(/[\s,;|()[\]<>"']+/);
    for (const tok of tokens) {
      const r = toHost(tok);
      if (!r) continue;
      if ("unclear" in r) {
        if (out.unclear.length < 20) out.unclear.push(r.unclear);
        continue;
      }
      if (seen.has(r.host)) out.duplicates += 1;
      else {
        seen.add(r.host);
        out.domains.push(r.host);
        if (r.email) out.fromEmails += 1;
      }
    }
  }
  return out;
}
