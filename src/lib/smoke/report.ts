/**
 * What a smoke check says. Each check ends in one of four states, with one plain sentence and, when something is off, a
 * hint at what to do. A check never throws and never prints a secret: everything passes through redact() before it is shown.
 */

export type Status = "pass" | "warn" | "fail" | "skip";

export interface Check {
  section: string;
  id: string;
  title: string;
  status: Status;
  detail: string;
  hint?: string;
}

export const pass = (section: string, id: string, title: string, detail: string, hint?: string): Check => ({ section, id, title, status: "pass", detail, hint });
export const warn = (section: string, id: string, title: string, detail: string, hint?: string): Check => ({ section, id, title, status: "warn", detail, hint });
export const fail = (section: string, id: string, title: string, detail: string, hint?: string): Check => ({ section, id, title, status: "fail", detail, hint });
export const skip = (section: string, id: string, title: string, detail: string, hint?: string): Check => ({ section, id, title, status: "skip", detail, hint });

/** Runs one check body. If it throws, that is a failed check with the error as its detail, not a crashed script. */
export async function safely(section: string, id: string, title: string, body: () => Promise<Check[] | Check>): Promise<Check[]> {
  try {
    const out = await body();
    return Array.isArray(out) ? out : [out];
  } catch (e) {
    return [fail(section, id, title, e instanceof Error ? e.message : "The check stopped unexpectedly.")];
  }
}

/** Replaces every secret value (and anything that looks like a bearer token) so a pasted report cannot leak a key. */
export function redact(text: string, secrets: (string | undefined | null)[]): string {
  let out = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1[hidden]");
  for (const s of secrets) {
    if (!s || s.length < 6) continue;
    out = out.split(s).join("[hidden]");
  }
  return out;
}

export type Verdict = "ready" | "unfinished" | "not-ready";

export function summarise(checks: Check[]) {
  const n = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) n[c.status] += 1;
  // Only a clean sheet is READY. Anything not checked, or worth a look, is unfinished; any failure is not ready.
  const verdict: Verdict = n.fail ? "not-ready" : n.warn || n.skip ? "unfinished" : "ready";
  return { ...n, ok: n.fail === 0, verdict };
}

const ICON: Record<Status, string> = { pass: "✓", warn: "!", fail: "✕", skip: "-" };
const COLOR: Record<Status, string> = { pass: "\x1b[32m", warn: "\x1b[33m", fail: "\x1b[31m", skip: "\x1b[90m" };
const RESET = "\x1b[0m";

export function render(checks: Check[], opts: { color?: boolean; secrets?: (string | undefined | null)[] } = {}): string {
  const paint = (s: Status, text: string) => (opts.color ? `${COLOR[s]}${text}${RESET}` : text);
  const lines: string[] = [];
  let section = "";
  for (const c of checks) {
    if (c.section !== section) {
      section = c.section;
      lines.push("", opts.color ? `\x1b[1m${section.toUpperCase()}${RESET}` : section.toUpperCase());
    }
    lines.push(`  ${paint(c.status, ICON[c.status])} ${c.title}: ${c.detail}`);
    if (c.hint) lines.push(`      ${opts.color ? "\x1b[90m" : ""}→ ${c.hint}${opts.color ? RESET : ""}`);
  }
  const s = summarise(checks);
  const label = { ready: "READY", unfinished: "NOT FINISHED", "not-ready": "NOT READY" }[s.verdict];
  const tone: Status = s.verdict === "ready" ? "pass" : s.verdict === "unfinished" ? "warn" : "fail";
  lines.push("", `${paint(tone, label)}  ${s.pass} passed, ${s.warn} to look at, ${s.fail} failed, ${s.skip} not checked`);
  if (s.verdict === "unfinished") lines.push("Nothing failed, but not everything was checked or confirmed. Work through the ! and - lines above.");
  return redact(lines.join("\n"), opts.secrets ?? []);
}
