import { normaliseDomain } from "@/lib/scrape/url-guard";

/**
 * Turns whatever a person pastes or uploads into a clean list of domains, and says exactly what was wrong with the rest.
 * Accepts one per line, comma or semicolon separated, or a CSV with a header row naming the column (domain, website, url,
 * company website). Nothing here fetches anything; it only decides what is worth putting in a run.
 */

export const MAX_INPUT_CHARS = 200_000;
export const MAX_ENTRIES = 1_000;

export interface Entry {
  input: string;
  domain: string | null;
  problem: string | null;
}

export interface ParsedList {
  valid: string[];
  rejected: { input: string; problem: string }[];
  duplicates: number;
  /** True when the input was cut because it was too long. */
  truncated: boolean;
}

const HEADER = /^(domain|domains|website|websites|url|urls|site|company website|company domain|web)$/i;

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

export function parseList(raw: string): ParsedList {
  const truncated = raw.length > MAX_INPUT_CHARS;
  const lines = raw.slice(0, MAX_INPUT_CHARS).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // A header row names the column to read. Without one, every cell is a candidate.
  const first = lines[0] ? splitCsvLine(lines[0]).map((c) => c.trim()) : [];
  const column = first.findIndex((c) => HEADER.test(c));
  const body = column >= 0 ? lines.slice(1) : lines;

  const candidates: string[] = [];
  for (const line of body) {
    const cells = column >= 0 ? [splitCsvLine(line)[column] ?? ""] : line.includes('"') ? splitCsvLine(line) : line.split(/[,;\t ]+/);
    for (const c of cells) if (c.trim()) candidates.push(c.trim());
  }

  const valid: string[] = [];
  const rejected: ParsedList["rejected"] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let cut = truncated;
  for (const input of candidates) {
    if (valid.length + rejected.length >= MAX_ENTRIES) {
      cut = true;
      break;
    }
    const r = normaliseDomain(input);
    if (!r.ok) rejected.push({ input: input.slice(0, 120), problem: r.reason });
    else if (seen.has(r.domain)) duplicates += 1;
    else {
      seen.add(r.domain);
      valid.push(r.domain);
    }
  }
  return { valid, rejected, duplicates, truncated: cut };
}

/**
 * Makes a value safe to open in a spreadsheet. A cell that starts with =, +, - or @ (or a tab or carriage return) can be
 * run as a formula, so it is prefixed with an apostrophe; and every cell is quoted so commas and line breaks stay inside.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");
