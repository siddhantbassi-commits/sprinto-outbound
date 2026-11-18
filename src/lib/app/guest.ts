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
