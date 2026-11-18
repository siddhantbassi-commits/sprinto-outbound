import type { DbPort, Row } from "@/lib/db/port";
import { lintEmail, type LintCheck } from "@/lib/email/lint";
import { companyName } from "@/lib/pitch/company";
import { allQuotes } from "@/lib/pitch/hooks";
import { allowedNumbersFor, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import type { Facts } from "@/lib/icp/types";
import { withSettings } from "@/lib/worker/pipeline";
import type { Settings } from "@/lib/worker/store";

/**
 * What a person needs in front of them to decide on a draft, gathered in one place: the email, why it says what it says,
 * who it is for, and whether anything about it is a risk. Reads only; deciding is done by the database functions.
 */

export interface ApprovalItem {
  prospectId: string;
  domain: string;
  company: string;
  verdict: string | null;
  score: number | null;
  updatedAt: string;
  email: { id: string; subject: string; body: string; checks: LintCheck[]; hook: { id: string; quote: string; source: string } | null; pains: { id: string; label: string }[] };
  contact: { name: string; title: string | null; email: string | null; confidence: number | null; source: string; rank: number | null } | null;
  reasons: { label: string; points: number; quote: string | null }[];
  flags: string[];
  /** Nothing about this draft needs a closer look: every check passed, the company qualified, a person and a real hook are named. */
  clean: boolean;
}

const rows = <T,>(r: Row[]) => r as unknown as T[];

/** Contact confidence below this is not clean: a wrong person is the costliest mistake a cold email can make. */
export const CLEAN_CONTACT_CONFIDENCE = 70;

/**
 * Nothing about the draft needs a closer look. Strict about real risk (a failed check, an unknown company size, a shaky
 * contact), relaxed about routine caveats such as "size is an estimate", so batch approval is usable and still safe.
 */
export const isClean = (i: Pick<ApprovalItem, "verdict" | "email" | "contact" | "flags">) =>
  i.verdict === "qualified" &&
  i.email.checks.length > 0 &&
  i.email.checks.every((c) => c.pass) &&
  !!i.email.hook &&
  !!i.contact &&
  (i.contact.confidence ?? 100) >= CLEAN_CONTACT_CONFIDENCE &&
  !i.flags.some((f) => /unknown/i.test(f));

/** Drafts waiting for a decision, oldest first, so nothing sits at the bottom of the list. */
export async function approvalQueue(db: DbPort, canSeeContacts: boolean, limit = 50): Promise<ApprovalItem[]> {
  const waiting = rows<{ id: string; domain: string; verdict: string | null; score: number | null; updated_at: string }>(
    await db.select("prospects", { lane: "review", step: "drafted" }, { order: "updated_at", ascending: true, limit, columns: "id,domain,verdict,score,updated_at" }),
  );
  if (waiting.length === 0) return [];
  const ids = new Set(waiting.map((w) => w.id));
  const [emails, reviews, contacts, scores, pages] = await Promise.all([
    db.select("emails", { status: "drafted" }, { order: "attempt", ascending: false, limit: 500 }),
    db.select("email_reviews", {}, { order: "created_at", ascending: false, limit: 1000, columns: "email_id" }),
    canSeeContacts ? db.select("contacts", { chosen: true }, { limit: 500 }) : db.select("contacts_masked", { chosen: true }, { limit: 500 }),
    db.select("scores", { replay: false }, { order: "created_at", ascending: false, limit: 1000, columns: "prospect_id,parts,flags" }),
    db.select("pages", { kind: "home" }, { limit: 1000, columns: "prospect_id,title" }),
  ]);
  const decided = new Set(reviews.map((r) => String(r.email_id)));
  const out: ApprovalItem[] = [];
  for (const w of waiting) {
    const e = emails.find((x) => String(x.prospect_id) === w.id && !decided.has(String(x.id)));
    if (!e || !ids.has(w.id)) continue;
    const c = contacts.find((x) => String(x.prospect_id) === w.id);
    const sc = scores.find((x) => String(x.prospect_id) === w.id);
    const parts = ((sc?.parts ?? []) as { label: string; points: number; quotes?: string[] }[]).filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
    const hook = (e.hook ?? null) as { id: string; quote: string; source: string } | null;
    const item: ApprovalItem = {
      prospectId: w.id,
      domain: w.domain,
      company: companyName(w.domain, (pages.find((p) => String(p.prospect_id) === w.id)?.title as string | undefined) ?? null),
      verdict: w.verdict,
      score: w.score === null ? null : Number(w.score),
      updatedAt: w.updated_at,
      email: { id: String(e.id), subject: String(e.subject), body: String(e.body), checks: (e.lint ?? []) as LintCheck[], hook, pains: ((e.picks ?? []) as { id: string; label: string }[]).map((p) => ({ id: p.id, label: p.label })) },
      contact: c
        ? {
            name: canSeeContacts ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "(name removed)" : `${String(c.first_initial ?? "?")} (details hidden for viewers)`,
            title: (c.position as string | null) ?? null,
            email: canSeeContacts ? ((c.email as string | null) ?? null) : ((c.email_masked as string | null) ?? null),
            confidence: c.confidence === null || c.confidence === undefined ? null : Number(c.confidence),
            source: String(c.source),
            rank: c.rank_score === null || c.rank_score === undefined ? null : Number(c.rank_score),
          }
        : null,
      reasons: parts.map((p) => ({ label: p.label, points: p.points, quote: p.quotes?.[0] ?? null })),
      flags: ((sc?.flags ?? []) as string[]).slice(0, 4),
      clean: false,
    };
    item.clean = isClean(item);
    out.push(item);
  }
  return out;
}

export interface EditLint {
  ok: boolean;
  failed: { id: string; message: string }[];
}

/**
 * The same twelve checks a drafted email must pass, applied to a person's edit. A person can change what the model wrote,
 * but not into a claim about Sprinto nobody verified, a figure the claims file does not allow, or a message with no way out.
 */
export async function lintDraftEdit(db: DbPort, emailId: string, subject: string, body: string): Promise<EditLint> {
  const [email] = await db.select("emails", { id: emailId });
  if (!email) return { ok: false, failed: [{ id: "L0", message: "That draft no longer exists." }] };
  const pid = String(email.prospect_id);
  const [prospect] = await db.select("prospects", { id: pid }, { columns: "domain" });
  const [contact] = await db.select("contacts", { prospect_id: pid, chosen: true });
  const [home] = await db.select("pages", { prospect_id: pid, kind: "home" }, { columns: "title" });
  const [factsRow] = await db.select("facts", { prospect_id: pid }, { order: "pass", ascending: false, limit: 1, columns: "facts" });
  const [fileRow] = await db.select("sprinto_facts_versions", {}, { order: "version", ascending: false, limit: 1 });
  const [settings] = await db.rpc("settings_now");
  if (!prospect || !contact || !fileRow || !settings) return { ok: false, failed: [{ id: "L0", message: "The details needed to check this edit are missing." }] };
  const file = withSettings(fileRow.content as SprintoFactsFile, settings as unknown as Pick<Settings, "sender_name" | "sender_title" | "postal_address">);
  const hook = (email.hook ?? null) as { quote?: string } | null;
  const res = lintEmail({
    subject,
    body,
    firstName: String(contact.first_name ?? "").trim(),
    company: companyName(String(prospect.domain), (home?.title as string | undefined) ?? null),
    hookQuote: hook?.quote ?? null,
    evidenceQuotes: factsRow ? allQuotes(factsRow.facts as Facts) : [],
    allowedNumbers: allowedNumbersFor(file),
    postalAddress: file.postalAddress.trim(),
  });
  return { ok: res.ok, failed: res.checks.filter((c) => !c.pass).map((c) => ({ id: c.id, message: c.message })) };
}
