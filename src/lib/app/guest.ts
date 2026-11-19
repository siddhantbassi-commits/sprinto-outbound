import type { Row } from "@/lib/db/port";

/**
 * The guest pass. A guest is not signed in; the server acts for them through one dedicated admin account, so they can do what an
 * admin does: change the ICP and the rules, edit settings, review and approve. Three rails stay, because the link is public and a
 * mistake or a stranger must not do lasting harm: a guest cannot manage people (they could lock the owner out), what they spend on
 * Hunter and the model is capped, and mail still goes only to the owner's own test address, which the server fixes, not the guest.
 * These are plain functions so each rule is tested.
 */

export interface GuestCaps {
  dailyTokens: number;
  dailyHunter: number;
  dailyCompanies: number;
  keepCredits: number;
}

export const GUEST_MAX_PER_RUN = 5;

export interface GuestUsage {
  /** Model tokens and Hunter credits recorded since the start of the UTC day, by anyone. */
  tokensToday: number;
  hunterToday: number;
  /** Companies guests started since the start of the UTC day. */
  companiesToday: number;
  /** Hunter's live credits left, or null when unknown. */
  hunterRemaining: number | null;
}

export type GuestVerdict = { ok: true } | { ok: false; message: string };

const ALL_OPEN = "The companies already researched, with their contacts, are all still open to read.";

/** Whether a guest may start a run of this many companies now. Every limit is counted from the database, so it holds across servers. */
export function guestMay(requested: number, u: GuestUsage, c: GuestCaps): GuestVerdict {
  if (requested < 1) return { ok: false, message: "Add at least one company first." };
  if (requested > GUEST_MAX_PER_RUN) return { ok: false, message: `A guest run can hold up to ${GUEST_MAX_PER_RUN} companies. You chose ${requested}. Remove some, then add the rest in a second run.` };
  if (u.companiesToday + requested > c.dailyCompanies) return { ok: false, message: `The guest allowance of researched companies for today is used up. It starts again tomorrow (UTC). ${ALL_OPEN}` };
  if (u.tokensToday >= c.dailyTokens) return { ok: false, message: `The guest allowance of model time for today is used up. It starts again tomorrow (UTC). ${ALL_OPEN}` };
  // A company that qualifies costs one credit, so a run of n could spend n. Never let it dip into the credits kept for the owner.
  if (u.hunterRemaining !== null) {
    const spare = u.hunterRemaining - c.keepCredits;
    if (spare >= 1 && requested > spare) return { ok: false, message: `Hunter has only ${spare} credit${spare === 1 ? "" : "s"} to spare for guests this month, so choose at most ${spare} compan${spare === 1 ? "y" : "ies"}. ${ALL_OPEN}` };
  }
  return guestMayPay(u, c);
}

/** Whether a guest may spend a Hunter credit now (a contact lookup, or the paid address check). */
export function guestMayPay(u: GuestUsage, c: GuestCaps): GuestVerdict {
  if (u.hunterRemaining !== null && u.hunterRemaining - c.keepCredits < 1) return { ok: false, message: `The Hunter credits kept for guests are used up for this month, so contact lookups are paused. ${ALL_OPEN}` };
  if (u.hunterToday >= c.dailyHunter) return { ok: false, message: `The guest allowance of contact lookups for today is used up. It starts again tomorrow (UTC). ${ALL_OPEN}` };
  return { ok: true };
}

const DAY_MS = 86_400_000;
export const startOfUtcDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;

/** Adds up today's usage from the recorded rows. */
export function sumUsage(ledger: Row[], runs: Row[], guestId: string, now: number): Pick<GuestUsage, "tokensToday" | "hunterToday" | "companiesToday"> {
  const from = startOfUtcDay(now);
  const today = (r: Row) => new Date(String(r.created_at)).getTime() >= from;
  let tokensToday = 0;
  let hunterToday = 0;
  for (const r of ledger) {
    if (!today(r)) continue;
    if (r.kind === "gemini_tokens") tokensToday += Number(r.units) || 0;
    else if (r.kind === "hunter_credits") hunterToday += Number(r.units) || 0;
  }
  const companiesToday = runs.filter((r) => today(r) && r.created_by === guestId).reduce((n, r) => n + (Number(r.domain_count) || 0), 0);
  return { tokensToday, hunterToday, companiesToday };
}

/** The one SQL line that makes the guest account an admin. The email is checked as a plain address first, so what is printed is safe to paste. */
export function promoteSql(email: string): string | null {
  const e = email.trim();
  if (!/^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/.test(e)) return null;
  return `update public.profiles set role = 'admin' where id = (select id from auth.users where email = '${e.replace(/'/g, "''")}');`;
}

export type Cooldown = { ok: true } | { ok: false; message: string; waitMinutes: number };

/**
 * Some actions are safe for an admin but would be easy to spam on a public link: emailing the owner a digest, spending model time on a
 * quality run. A guest may do each only once per window, judged from the newest recorded row, so it holds across servers.
 */
export function guestCooldown(lastAt: string | null | undefined, now: number, minutes: number, what: string): Cooldown {
  if (!lastAt) return { ok: true };
  const last = new Date(lastAt).getTime();
  if (!Number.isFinite(last)) return { ok: true };
  const waitMs = last + minutes * 60_000 - now;
  if (waitMs <= 0) return { ok: true };
  const waitMinutes = Math.ceil(waitMs / 60_000);
  return { ok: false, waitMinutes, message: `${what} was run recently, and guests can run it once every ${minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`}. Try again in about ${waitMinutes >= 90 ? `${Math.round(waitMinutes / 60)} hours` : `${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}`}. The last result is still on the page.` };
}

/**
 * The settings that decide what can be spent and where mail goes. A guest is an admin for everything else, but these are fixed for
 * them at the owner's values: otherwise a guest could zero the Hunter reserve, lift the token limits, turn approval off, raise the
 * send cap, or blank the test address (which silently stops all sending) and so undo every other rail.
 */
export const GUEST_PINNED = ["test_to", "daily_send_cap", "max_run_size", "max_parallel", "hunter_reserve", "tokens_per_domain", "tokens_per_run", "mail_cooldown_days", "require_approval"] as const;

/** The row a guest's settings change would write, with every pinned value put back to what it was. Without a previous row, approval is forced on. */
export function pinGuestSettings(row: Record<string, unknown>, previous: Record<string, unknown> | null): Record<string, unknown> {
  const out = { ...row };
  for (const k of GUEST_PINNED) {
    if (previous && k in previous) out[k] = previous[k];
    else if (k === "require_approval") out[k] = true;
  }
  return out;
}

/** Re-running or promoting a company spends model time and maybe a Hunter credit, so a guest has a daily number of them. */
export const GUEST_MAX_RESUMES = 12;

export function guestMayResume(u: GuestUsage, c: GuestCaps, resumesToday: number): GuestVerdict {
  if (resumesToday >= GUEST_MAX_RESUMES) return { ok: false, message: `Guests can put ${GUEST_MAX_RESUMES} companies back in the queue a day, and that is used up. It starts again tomorrow (UTC). ${ALL_OPEN}` };
  if (u.tokensToday >= c.dailyTokens) return { ok: false, message: `The guest allowance of model time for today is used up. It starts again tomorrow (UTC). ${ALL_OPEN}` };
  return guestMayPay(u, c);
}

/** Questions a guest may ask in a day, counted from the database. Each can spend a large share of a model budget. */
export const GUEST_DAILY_ASKS = 20;

export function guestMayAsk(asksToday: number, limit: number = GUEST_DAILY_ASKS): GuestVerdict {
  return asksToday >= limit ? { ok: false, message: `Guests can ask ${limit} questions a day, and that is used up. It starts again tomorrow (UTC). Everything researched is still open to read.` } : { ok: true };
}

/** How many of these rows were written today (UTC) by this person. */
export function countToday(rows: Row[], by: string, now: number, kinds?: readonly string[]): number {
  const from = startOfUtcDay(now);
  return rows.filter((r) => r.created_by === by && new Date(String(r.created_at)).getTime() >= from && (!kinds || kinds.includes(String(r.kind)))).length;
}

/**
 * Runs one thing at a time per key in this server process. The caps read usage and write later, so two requests at the same instant
 * would both pass. This closes that gap within a server; across servers the caps are checked again afterwards and a run that went over is paused.
 */
export function createSerial() {
  const tails = new Map<string, Promise<unknown>>();
  return async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    tails.set(key, next);
    try {
      return await next;
    } finally {
      if (tails.get(key) === next) tails.delete(key);
    }
  };
}

/** One long guest action at a time (a digest, a golden-set run): a second request while one is running is turned away, not queued. */
export function createFlight() {
  const running = new Set<string>();
  return async function flight<T>(key: string, fn: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
    if (running.has(key)) return { busy: true };
    running.add(key);
    try {
      return { busy: false, value: await fn() };
    } finally {
      running.delete(key);
    }
  };
}
