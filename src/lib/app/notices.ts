/**
 * The notification history: what the app told a person, kept so a finished run is not lost if the toast was missed. Kept in this
 * browser only (it is a convenience, not a record), capped, and de-duplicated so a run that finishes twice in a poll does not
 * appear twice. Pure, so each rule is tested; the browser code only reads and writes it.
 */

export interface Notice {
  id: string;
  at: number;
  text: string;
  /** Where clicking it goes. */
  href: string | null;
}

export const MAX_NOTICES = 30;
export const NOTICES_KEY = "sprinto.notices";
export const SEEN_KEY = "sprinto.notices.seen";

/** Adds a notice at the front, drops a repeat of the same id, and keeps the newest MAX_NOTICES. */
export function addNotice(list: Notice[], n: Notice): Notice[] {
  return [n, ...list.filter((x) => x.id !== n.id)].slice(0, MAX_NOTICES);
}

/** How many notices arrived after the person last opened the list. */
export const unreadCount = (list: Notice[], seenAt: number): number => list.filter((n) => n.at > seenAt).length;

/** Reads a stored list, keeping only well-formed entries, newest first. Anything else in storage is ignored. */
export function readNotices(raw: unknown): Notice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Notice => !!x && typeof x.id === "string" && typeof x.at === "number" && Number.isFinite(x.at) && typeof x.text === "string" && (x.href === null || (typeof x.href === "string" && /^\/(?![/\\])/.test(x.href))))
    .map((x) => ({ id: x.id.slice(0, 80), at: x.at, text: x.text.slice(0, 200), href: x.href }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_NOTICES);
}

/** "just now", "5 min ago", "2 hours ago", "yesterday", or the date, the way a person would say it. */
export function whenText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
