/**
 * Reads the server's environment once, into a typed shape, and says plainly what is missing. Nothing here is ever sent to
 * the browser: keys live only in the server environment (Vercel), and this module is imported only by server code.
 */

export type Raw = Record<string, string | undefined>;

export interface AppEnv {
  /** "demo" runs on sample data in memory with a pretend model; it exists to show the product without any keys. */
  mode: "supabase" | "demo";
  supabase: { url: string; anonKey: string } | null;
  worker: { email: string; password: string } | null;
  cronSecret: string | null;
  gemini: { apiKey: string; model: string | undefined } | null;
  hunterKey: string | null;
  gmail: { clientId: string; clientSecret: string; refreshToken: string; from: string; fromName: string | undefined } | null;
  /** The only address test mode may mail. */
  testTo: string | null;
  appUrl: string | null;
  /** Named in the scraper's user agent so a site owner can reach us. */
  contactEmail: string;
  /** Things that are wrong or not yet set, in plain words, for the settings page. */
  problems: string[];
}

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, "");
const text = (v: string | undefined) => (v ?? "").trim();
const some = (v: string | undefined) => (clean(v) === "" ? null : clean(v));

/**
 * The names (never the values) of any real credentials present. A public demo is allowed in production only when this is empty:
 * it must be a deployment that holds nothing real, so there is nothing for a visitor to reach even if every page is open.
 */
export function realCredentials(raw: Raw): string[] {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "WORKER_EMAIL", "WORKER_PASSWORD", "CRON_SECRET", "GEMINI_API_KEY", "HUNTER_API_KEY", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_FROM", "OUTBOUND_TEST_TO"];
  return names.filter((n) => clean(raw[n]) !== "");
}

export function readEnv(raw: Raw = process.env): AppEnv {
  const problems: string[] = [];
  const url = some(raw.NEXT_PUBLIC_SUPABASE_URL) ?? some(raw.SUPABASE_URL);
  const anonKey = some(raw.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? some(raw.SUPABASE_ANON_KEY);
  const production = raw.VERCEL_ENV === "production";

  let mode: AppEnv["mode"] = "supabase";
  if (raw.DEMO_MODE === "1") {
    const real = realCredentials(raw);
    if (url) problems.push("DEMO_MODE is set but a Supabase project is configured, so demo mode was ignored.");
    else if (production && raw.DEMO_PUBLIC !== "1") problems.push("DEMO_MODE is set in a production deployment, so it was ignored.");
    else if (production && real.length > 0) problems.push(`DEMO_MODE is set in a production deployment that also holds real credentials (${real.join(", ")}), so it was ignored. A public demo must hold none.`);
    else mode = "demo";
  }

  const supabase = url && anonKey ? { url, anonKey } : null;
  if (mode === "supabase" && !supabase) problems.push("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY).");

  const workerEmail = text(raw.WORKER_EMAIL);
  const workerPassword = raw.WORKER_PASSWORD ?? "";
  const worker = workerEmail && workerPassword ? { email: workerEmail, password: workerPassword } : null;
  if (mode === "supabase" && !worker) problems.push("The worker account is not configured (WORKER_EMAIL and WORKER_PASSWORD), so nothing can run.");

  const cronSecret = some(raw.CRON_SECRET);
  if (mode === "supabase" && (!cronSecret || cronSecret.length < 24)) problems.push("CRON_SECRET is missing or shorter than 24 characters, so the scheduled worker cannot call in.");

  const geminiKey = some(raw.GEMINI_API_KEY);
  const gemini = geminiKey ? { apiKey: geminiKey, model: some(raw.GEMINI_MODEL) ?? undefined } : null;
  if (mode === "supabase" && !gemini) problems.push("GEMINI_API_KEY is not set, so companies cannot be read.");

  const hunterKey = some(raw.HUNTER_API_KEY);
  if (mode === "supabase" && !hunterKey) problems.push("HUNTER_API_KEY is not set. Only hand-picked contacts will work.");

  const g = { clientId: some(raw.GMAIL_CLIENT_ID), clientSecret: some(raw.GMAIL_CLIENT_SECRET), refreshToken: some(raw.GMAIL_REFRESH_TOKEN), from: some(raw.GMAIL_FROM) };
  const gmail = g.clientId && g.clientSecret && g.refreshToken && g.from ? { clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken, from: g.from, fromName: text(raw.GMAIL_FROM_NAME) || undefined } : null;
  if (mode === "supabase" && !gmail) problems.push("Gmail is not fully configured (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_FROM), so nothing can be sent.");

  const testTo = some(raw.OUTBOUND_TEST_TO);
  if (mode === "supabase" && !testTo) problems.push("OUTBOUND_TEST_TO is not set, so test mode has no address.");

  const appUrl = some(raw.APP_URL) ?? (raw.VERCEL_URL ? `https://${clean(raw.VERCEL_URL)}` : null);
  return { mode, supabase, worker, cronSecret, gemini, hunterKey, gmail, testTo, appUrl, contactEmail: some(raw.OUTBOUND_CONTACT_EMAIL) ?? testTo ?? "outbound@example.com", problems };
}

/** Compares two secrets without leaking, through timing, how much of the first one matched. */
export function sameSecret(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
