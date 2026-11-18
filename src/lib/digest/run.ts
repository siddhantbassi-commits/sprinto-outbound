/**
 * The weekly discovery digest, start to finish: run the saved search, keep only companies that are new (not researched,
 * suppressed or mailed, and not shown in an earlier digest), email the owner a short note, and record what happened. It
 * reads and tells; it spends no Hunter credit and no model tokens, and it never contacts a company.
 *
 * Safe to call more than once: a digest that ran in the last six days is not repeated unless a person asks for it, so a
 * late or doubled scheduled call does no harm.
 */

import type { HunterClient } from "@/lib/contacts/hunter";
import type { GmailSender } from "@/lib/email/gmail";
import { currentSettings } from "@/lib/app/queries";
import { loadKnown } from "@/lib/app/known";
import type { DbPort } from "@/lib/db/port";
import { defaultCriteria, normaliseCriteria, type Criteria } from "@/lib/discovery/criteria";
import { discover as realDiscover, type Outcome } from "@/lib/discovery/discover";
import type { FetchDeps } from "@/lib/scrape/fetch";
import { ICP_V1 } from "@/lib/icp/config";
import { digestHtml, digestSubject, digestText, type DigestCompany } from "./email";

export const DUE_DAYS = 6;
export const DAY_MS = 86_400_000;
/** Most companies one digest keeps and shows. The rest of a long list will be new next week, when they are still unseen. */
export const MAX_KEPT = 20;
/** How many earlier digests are read to know what has been shown before. */
export const HISTORY = 26;

export interface SearchRow {
  version: number;
  enabled: boolean;
  criteria: unknown;
  reason: string;
  created_at: string;
}

export interface DigestRow {
  id: string;
  seq: number | string;
  trigger: "cron" | "browser";
  criteria: unknown;
  considered: number;
  found: DigestCompany[];
  by_angle: Record<string, number | null>;
  problems: string[];
  email_status: "sent" | "failed" | "skipped" | "not_sent";
  email_note: string;
  created_at: string;
}

export async function loadSearch(db: DbPort): Promise<SearchRow | null> {
  const [r] = await db.select("digest_searches", {}, { order: "version", ascending: false, limit: 1 });
  return (r as unknown as SearchRow) ?? null;
}

export async function loadDigests(db: DbPort, limit = HISTORY): Promise<DigestRow[]> {
  return (await db.select("digests", {}, { order: "seq", ascending: false, limit })) as unknown as DigestRow[];
}

export type Skip = "no_search" | "off" | "recent";

/** Whether a digest is due: there is an enabled search and the last one was more than six days ago (or a person forced it). */
export function dueCheck(search: SearchRow | null, last: Pick<DigestRow, "created_at"> | null, now: number, force: boolean): { due: true } | { due: false; reason: Skip } {
  if (!search) return { due: false, reason: "no_search" };
  if (!search.enabled && !force) return { due: false, reason: "off" };
  if (!force && last && now - new Date(last.created_at).getTime() < DUE_DAYS * DAY_MS) return { due: false, reason: "recent" };
  return { due: true };
}

/** When the next scheduled digest can run: seven days after the last, or right away if there has been none. */
export function nextDue(last: Pick<DigestRow, "created_at"> | null, now: number): number {
  return last ? Math.max(now, new Date(last.created_at).getTime() + DUE_DAYS * DAY_MS) : now;
}

export interface DigestDeps {
  /** Whoever is running it: the worker's own database session, or a signed-in person's. */
  db: DbPort;
  hunter: HunterClient;
  fetchDeps: FetchDeps;
  gmail: GmailSender | null;
  appUrl: string | null;
  trigger: "cron" | "browser";
  /** A person pressed the button: run even if one ran recently, or the search is switched off. */
  force?: boolean;
  now?: () => number;
  /** Replaced in tests. */
  discover?: (c: Criteria) => Promise<Outcome>;
}

export type DigestResult = { status: "skipped"; reason: Skip } | { status: "ran"; digest: DigestRow };

const dayStamp = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const weekOf = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export async function runDigest(d: DigestDeps): Promise<DigestResult> {
  const now = (d.now ?? Date.now)();
  const [search, history] = await Promise.all([loadSearch(d.db), loadDigests(d.db)]);
  const check = dueCheck(search, history[0] ?? null, now, d.force === true);
  if (!check.due) return { status: "skipped", reason: check.reason };

  const criteria = normaliseCriteria(search!.criteria, defaultCriteria(ICP_V1));
  const settings = await currentSettings(d.db);
  const seen = new Set(history.flatMap((h) => (Array.isArray(h.found) ? h.found.map((c) => c.domain) : [])));

  let found: DigestCompany[] = [];
  let considered = 0;
  let byAngle: Record<string, number | null> = {};
  const problems: string[] = [];
  try {
    const known = await loadKnown(d.db, settings?.mail_cooldown_days ?? 30);
    const run = d.discover ?? ((c: Criteria) => realDiscover(c, { hunter: d.hunter, fetchDeps: d.fetchDeps, known }));
    const out = await run(criteria);
    considered = out.considered;
    byAngle = out.byAngle as Record<string, number | null>;
    problems.push(...out.problems);
    found = out.found
      .filter((f) => f.standing === "new" && !seen.has(f.domain))
      .slice(0, MAX_KEPT)
      .map((f) => ({ domain: f.domain, name: f.name, about: f.about, because: f.because, emailsTotal: f.emailsTotal }));
  } catch (e) {
    problems.push(e instanceof Error ? e.message : "The search failed.");
  }

  // Tell the owner, and only the owner: the same fixed recipient the rest of the product uses, and only when it matches the setting.
  let email_status: DigestRow["email_status"] = "not_sent";
  let email_note = "";
  if (found.length === 0) {
    email_note = problems.length ? "The search did not complete, so there was nothing to send." : "Nothing new this week.";
  } else if (!d.gmail) {
    email_status = "skipped";
    email_note = "Gmail is not set up, so no email was sent.";
  } else if (!settings?.test_to || settings.test_to.toLowerCase() !== d.gmail.recipient.toLowerCase()) {
    email_status = "skipped";
    email_note = "The test address in settings does not match the server's own, so no email was sent.";
  } else {
    const input = { companies: found, considered, appUrl: d.appUrl, weekOf: weekOf(now) };
    const out = await d.gmail.sendTest({ subject: digestSubject(found.length), body: digestText(input), html: digestHtml(input), runId: `digest-${dayStamp(now)}` });
    if (out.status === "sent") email_status = "sent";
    else {
      email_status = "failed";
      email_note = (out.status === "unknown" ? "It may or may not have been delivered: " : "") + out.reason.slice(0, 250);
    }
  }

  const [row] = await d.db.rpc("record_digest", {
    p_trigger: d.trigger,
    p_criteria: criteria,
    p_considered: considered,
    p_found: found,
    p_by_angle: byAngle,
    p_problems: problems,
    p_email_status: email_status,
    p_email_note: email_note,
  });
  return { status: "ran", digest: row as unknown as DigestRow };
}
