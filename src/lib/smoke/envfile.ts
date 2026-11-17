import { isPlainAddress } from "@/lib/email/mime";
import { fail, pass, warn, type Check } from "./report";

/**
 * The keys this project needs, how to ask for each, and a safe way to write them to .env.local. Nothing here ever echoes a
 * value: the prompt hides input, the report shows names only, and the file is written readable by its owner alone.
 */

export interface KeyDef {
  name: string;
  label: string;
  group: string;
  /** Hidden while typed, and never shown back. */
  secret: boolean;
  optional?: boolean;
  help: string;
  validate?: (v: string) => string | null;
  /** A value the script can make up itself (a random secret). */
  generate?: () => string;
}

const nonEmpty = (min: number, what: string) => (v: string) => (v.length >= min && !/\s/.test(v) ? null : `${what} should be at least ${min} characters with no spaces.`);
const address = (v: string) => (isPlainAddress(v) ? null : "Enter one plain email address.");
const url = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.hostname === "localhost" ? null : "Use an https:// address.";
  } catch {
    return "That is not a web address.";
  }
};

export const KEY_DEFS: KeyDef[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase project URL", group: "Supabase", secret: false, help: "Supabase > Project Settings > API > Project URL", validate: url },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Supabase anon (public) key", group: "Supabase", secret: true, help: "Same page: the anon / public key. It is public by design, but there is no reason to display it.", validate: nonEmpty(20, "The key") },
  { name: "WORKER_EMAIL", label: "Worker account email", group: "Supabase", secret: false, help: "The scheduler's own login. Invite it in Supabase, then set its role to worker.", validate: address },
  { name: "WORKER_PASSWORD", label: "Worker account password", group: "Supabase", secret: true, help: "Choose a long random one.", validate: nonEmpty(12, "The password") },
  { name: "CRON_SECRET", label: "Cron secret", group: "Deployment", secret: true, help: "Shared with the GitHub Worker workflow. Press g to generate a strong one.", validate: nonEmpty(24, "The secret"), generate: () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("") },
  { name: "APP_URL", label: "The app's public address", group: "Deployment", secret: false, help: "For example https://sprinto-outbound.vercel.app", validate: url },
  { name: "GEMINI_API_KEY", label: "Gemini API key", group: "Gemini", secret: true, help: "From Google AI Studio.", validate: nonEmpty(20, "The key") },
  { name: "GEMINI_MODEL", label: "Pin one Gemini model", group: "Gemini", secret: false, optional: true, help: "Leave empty to use the built-in chain. The smoke test tells you which names exist.", validate: (v) => (/^[a-z0-9.-]{3,60}$/.test(v) ? null : "A model name looks like gemini-3.6-flash.") },
  { name: "HUNTER_API_KEY", label: "Hunter API key", group: "Hunter", secret: true, optional: true, help: "Without it only hand-picked contacts work.", validate: nonEmpty(20, "The key") },
  { name: "GMAIL_CLIENT_ID", label: "Gmail OAuth client ID", group: "Gmail", secret: true, help: "From your Google Cloud OAuth client.", validate: nonEmpty(20, "The ID") },
  { name: "GMAIL_CLIENT_SECRET", label: "Gmail OAuth client secret", group: "Gmail", secret: true, help: "Same client.", validate: nonEmpty(10, "The secret") },
  { name: "GMAIL_REFRESH_TOKEN", label: "Gmail refresh token", group: "Gmail", secret: true, help: "Made by the one-off token helper, with only the gmail.send scope.", validate: nonEmpty(20, "The token") },
  { name: "GMAIL_FROM", label: "Gmail sender address", group: "Gmail", secret: false, help: "The account the token belongs to.", validate: address },
  { name: "GMAIL_FROM_NAME", label: "Sender display name", group: "Gmail", secret: false, optional: true, help: "Shown as the From name." },
  { name: "OUTBOUND_TEST_TO", label: "Test address", group: "Gmail", secret: false, help: "The ONLY address test mode can mail. Your own inbox. It must match Settings in the app.", validate: address },
  { name: "OUTBOUND_CONTACT_EMAIL", label: "Contact address for the scraper's user agent", group: "Deployment", secret: false, optional: true, help: "So a site owner can reach you. Defaults to the test address.", validate: address },
];

export const SECRET_NAMES = KEY_DEFS.filter((k) => k.secret).map((k) => k.name).concat(["SUPABASE_SERVICE_ROLE_KEY"]);

// ---------------------------------------------------------------- .env.local text
const SAFE = /^[A-Za-z0-9_./:@+=,-]*$/;

/** One value, written so that Node's own .env reader gives back exactly what was typed. Refuses anything it cannot do safely. */
export function formatValue(v: string): string {
  if (/[\r\n\0]/.test(v)) throw new Error("A value cannot contain a line break.");
  if (SAFE.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"') && !/[\\$`]/.test(v)) return `"${v}"`;
  throw new Error("That value contains both kinds of quote; add it to .env.local by hand.");
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = (m[2] as string).trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1] as string] = v;
  }
  return out;
}

/** Applies updates (an empty string removes a key) to existing text, keeping comments, order and every other line. */
export function mergeEnv(text: string, updates: Record<string, string>): string {
  const lines = text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const done = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const name = m?.[1];
    if (name && name in updates) {
      done.add(name);
      if (updates[name] !== "") out.push(`${name}=${formatValue(updates[name] as string)}`);
      continue;
    }
    out.push(line);
  }
  const added = Object.entries(updates).filter(([k, v]) => !done.has(k) && v !== "");
  for (const [k, v] of added) out.push(`${k}=${formatValue(v)}`);
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------- what is set
type Raw = Record<string, string | undefined>;
const set = (raw: Raw, k: string) => (raw[k] ?? "").trim() !== "";

/** Names only, never values: which keys are present, and what the missing ones will stop. */
export function envChecks(raw: Raw): Check[] {
  const S = "environment";
  const out: Check[] = [];
  const groups = new Map<string, KeyDef[]>();
  for (const k of KEY_DEFS) groups.set(k.group, [...(groups.get(k.group) ?? []), k]);
  for (const [group, defs] of groups) {
    const missing = defs.filter((d) => !d.optional && !set(raw, d.name));
    const optionalMissing = defs.filter((d) => d.optional && !set(raw, d.name));
    const id = group.toLowerCase();
    if (missing.length) out.push(group === "Supabase" || group === "Deployment" || group === "Gmail" || group === "Gemini" ? warn(S, id, `${group} keys`, `not set: ${missing.map((m) => m.name).join(", ")}`, "Run `npm run keys` to enter them through a hidden prompt.") : warn(S, id, `${group} keys`, `not set: ${missing.map((m) => m.name).join(", ")}`));
    else if (defs.every((d) => d.optional) && optionalMissing.length === defs.length) out.push(pass(S, id, `${group} keys`, `not set (optional): ${optionalMissing.map((o) => o.name).join(", ")}`));
    else out.push(pass(S, id, `${group} keys`, `all set${optionalMissing.length ? ` (optional, not set: ${optionalMissing.map((o) => o.name).join(", ")})` : ""}`));
  }
  if (set(raw, "SUPABASE_SERVICE_ROLE_KEY")) out.push(fail(S, "service-role", "No service-role key", "SUPABASE_SERVICE_ROLE_KEY is present", "This project never uses it. Remove it from this environment."));
  return out;
}
