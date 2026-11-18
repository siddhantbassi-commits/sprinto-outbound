/** Small, pure helpers for showing things to people. */

export function ago(iso: string | Date | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

export const dateTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "";

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export const LANES: Record<string, { label: string; tone: Tone; help: string }> = {
  active: { label: "In progress", tone: "info", help: "Still moving through the steps." },
  sent: { label: "Sent (test)", tone: "good", help: "The email was sent to your test inbox." },
  not_fit: { label: "Not a fit", tone: "muted", help: "The company scored below the ICP, or failed a gate." },
  needs_more: { label: "Needs more", tone: "warn", help: "Not enough on the site to judge. Nothing was guessed." },
  review: { label: "Needs a person", tone: "warn", help: "A person decides whether to continue." },
  no_contact: { label: "No contact", tone: "warn", help: "No suitable named person was found." },
  held: { label: "Held", tone: "warn", help: "Stopped before sending, with a reason." },
  skipped: { label: "Skipped", tone: "muted", help: "Suppressed, recently mailed, or not a valid domain." },
  unknown: { label: "Send unknown", tone: "bad", help: "Gmail may or may not have sent it. Check Sent, then resolve." },
  failed: { label: "Failed", tone: "bad", help: "Failed after retries, or in a way retrying cannot fix." },
};

export const STEPS: Record<string, string> = {
  queued: "Waiting to be read",
  scraped: "Site read",
  qualified: "Qualified",
  contact_found: "Contact found",
  pains_chosen: "Pains chosen",
  drafted: "Draft written",
  sent: "Sent",
};

export const STEP_ORDER = ["queued", "scraped", "qualified", "contact_found", "pains_chosen", "drafted", "sent"];

export const ACTIONS: Record<string, string> = { create: "Added to the run", scrape: "Read the website", qualify: "Qualified against the ICP", contact: "Found the person", pains: "Chose two pains", draft: "Wrote the email", send: "Sent the test email", sweep: "Cleaned up a stuck send" };

export const VERDICTS: Record<string, { label: string; tone: Tone }> = {
  qualified: { label: "Qualified", tone: "good" },
  maybe: { label: "Maybe", tone: "warn" },
  not_fit: { label: "Not a fit", tone: "muted" },
  needs_more: { label: "Needs more", tone: "warn" },
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short, honest wording for a token count. */
export const tokens = (n: number | null | undefined) => (n === null || n === undefined ? "" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** How a run began, in words. A run from Discover was chosen from companies the system found; the others were given a list. */
export const RUN_SOURCE: Record<string, { label: string; how: string }> = {
  discover: { label: "Discovered", how: "chosen from a Discover search" },
  paste: { label: "Pasted", how: "from a pasted list" },
  csv: { label: "CSV", how: "from a CSV" },
};
export const runSource = (source: string) => RUN_SOURCE[source] ?? { label: source, how: `from ${source}` };
