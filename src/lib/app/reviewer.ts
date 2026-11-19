import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { isPlainAddress } from "@/lib/email/mime";

/**
 * The reviewer's own inbox. In test mode every email goes to one address, the owner's. A reviewer (the person marking the work) can
 * instead have the test email sent to their own address, but only after proving the address is theirs: we send a six-digit code to
 * it, and they type it back. Nobody can point test mail at someone else's inbox, because they cannot read that inbox.
 *
 * Everything here is pure and tested. The key is derived on the server from a secret that never leaves it; the database stores only
 * a keyed hash of each code, never the code. A confirmed address is remembered in the reviewer's browser in a signed cookie, and the
 * database independently refuses an approval to an address that was not confirmed in the last day.
 */

export const REVIEWER_COOKIE = "sprinto_reviewer";
export const CODE_LIFE_MS = 15 * 60_000;
export const CONFIRM_LIFE_MS = 24 * 3_600_000;

/** The key for hashes and cookies, derived from server-held secrets. Null (feature off) when the server holds none to derive it from. */
export function reviewerKey(secrets: { cron: string | null; gmailSecret: string | null }): Buffer | null {
  const base = secrets.cron && secrets.cron.length >= 24 ? secrets.cron : secrets.gmailSecret && secrets.gmailSecret.length >= 16 ? secrets.gmailSecret : null;
  return base ? createHmac("sha256", "sprinto-outbound/reviewer-inbox/v1").update(base).digest() : null;
}

/** A plain, lower-case address, or null. No display names, no lists, no odd characters: one address and nothing else. */
export function normaliseAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return isPlainAddress(s) ? s : null;
}

/** Six digits, from a cryptographic source. */
export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** The cleaned form of what the reviewer typed: digits only, exactly six, or null. */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(s) ? s : null;
}

/** What the database stores in place of a code: 64 hex characters that cannot be turned back into the code without the key. */
export const codeHash = (key: Buffer, address: string, code: string): string => createHmac("sha256", key).update(`code|${address}|${code}`).digest("hex");

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (key: Buffer, body: string) => createHmac("sha256", key).update(`cookie|${body}`).digest("base64url");

/** The value of the cookie that remembers a confirmed address until `expires`. */
export function makeToken(key: Buffer, address: string, expires: number): string {
  const body = `${b64(address)}.${Math.floor(expires)}`;
  return `${body}.${sign(key, body)}`;
}

/** The address a cookie vouches for, or null when it is forged, damaged or out of date. */
export function readToken(key: Buffer, token: string | undefined, now: number): string | null {
  if (!token || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [a, exp, sig] = parts as [string, string, string];
  const want = Buffer.from(sign(key, `${a}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires <= now) return null;
  return normaliseAddress(unb64(a));
}

/** "ab•••@school.edu": enough to recognise your own address, not enough to read someone else's. */
export function maskAddress(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(3, Math.min(6, local.length - 2)))}@${domain}`;
}
