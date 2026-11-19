"use server";
import { revalidatePath } from "next/cache";
import { editRatio } from "@/lib/app/editdiff";
import { approvalQueue, lintDraftEdit } from "@/lib/app/review";
import { getSession, type AppSession } from "@/lib/app/runtime";
import { confirmedReviewer } from "@/lib/app/reviewer-session";

export interface DecisionResult {
  ok: boolean;
  message: string;
  /** Checks an edit did not pass, so the reviewer sees exactly what to fix. */
  failed?: { id: string; message: string }[];
}

const MAX_BATCH = 25;
const ERR = (e: unknown) => (e instanceof Error ? e.message : "That did not work.");
const norm = (s: string) => s.replace(/\r\n/g, "\n");

async function operator(): Promise<AppSession | null> {
  const s = await getSession();
  return s && (s.user.role === "operator" || s.user.role === "admin") ? s : null;
}

const refresh = () => {
  revalidatePath("/review");
  revalidatePath("/");
  revalidatePath("/impact");
};

/** Approves a draft, as written or with the reviewer's edits. An edit must pass the same twelve checks the model's draft did. */
export async function approveDraft(emailId: string, subjectIn: string, bodyIn: string, note = ""): Promise<DecisionResult> {
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can approve an email." };
  const subject = norm(String(subjectIn ?? "")).trim().slice(0, 200);
  const body = norm(String(bodyIn ?? "")).trimEnd().slice(0, 6000);
  if (!subject || !body.trim()) return { ok: false, message: "The subject and body cannot be empty." };
  const deliverTo = await confirmedReviewer();
  try {
    const [email] = await s.db.select("emails", { id: String(emailId) });
    if (!email) return { ok: false, message: "That draft no longer exists." };
    const before = { subject: norm(String(email.subject)), body: norm(String(email.body)) };
    const edited = subject !== before.subject || body !== before.body;
    if (edited) {
      const lint = await lintDraftEdit(s.db, String(emailId), subject, body);
      if (!lint.ok) return { ok: false, message: `Your edit breaks ${lint.failed.length} ${lint.failed.length === 1 ? "check" : "checks"}. Fix ${lint.failed.length === 1 ? "it" : "them"} to approve.`, failed: lint.failed };
    }
    const ratio = edited ? editRatio(`${before.subject}\n${before.body}`, `${subject}\n${body}`) : 0;
    // The address is only passed when there is one, so the usual approval is exactly what it always was.
    await s.db.rpc("approve_email", { p_email: String(emailId), p_subject: subject, p_body: body, p_edit_ratio: ratio, p_note: String(note ?? "").trim().slice(0, 300), ...(deliverTo ? { p_deliver_to: deliverTo } : {}) });
  } catch (e) {
    return { ok: false, message: ERR(e) };
  }
  refresh();
  return { ok: true, message: deliverTo ? "Approved. It will be delivered to your own address on the next worker pass." : "Approved. It will send on the next worker pass." };
}

const REASONS: Record<string, string> = { weak_hook: "The opening is weak", wrong_person: "Wrong person", not_fit: "Not a fit after all", timing: "Not the right time", other: "Other" };

/** Rejects a draft with a reason. "Wrong person" is recorded as such, which is what contact accuracy is measured from. */
export async function rejectDraft(emailId: string, category: string, noteIn = ""): Promise<DecisionResult> {
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can reject an email." };
  const label = REASONS[String(category)];
  if (!label) return { ok: false, message: "Choose a reason." };
  const note = String(noteIn ?? "").trim().slice(0, 240);
  if (category === "other" && note.length < 3) return { ok: false, message: "Say what is wrong (at least 3 characters)." };
  try {
    await s.db.rpc("reject_email", { p_email: String(emailId), p_reason: note ? `${label}: ${note}` : label, p_wrong_contact: category === "wrong_person" });
  } catch (e) {
    return { ok: false, message: ERR(e) };
  }
  refresh();
  return { ok: true, message: "Rejected, with your reason recorded." };
}

/**
 * Approves every draft that is clean, as written. "Clean" is decided here, on the server, from the stored draft and checks:
 * the browser's idea of what is clean is never trusted. Capped, so one click cannot release an unreviewed flood.
 */
export async function approveAllClean(): Promise<DecisionResult & { approved: number }> {
  const s = await operator();
  if (!s) return { ok: false, approved: 0, message: "Only an operator or admin can approve emails." };
  try {
    const clean = (await approvalQueue(s.db, true, 100)).filter((i) => i.clean).slice(0, MAX_BATCH);
    if (clean.length === 0) return { ok: true, approved: 0, message: "No draft is clean enough to approve in bulk. Open each to review it." };
    let approved = 0;
    const deliverTo = await confirmedReviewer();
    for (const i of clean) {
      try {
        await s.db.rpc("approve_email", { p_email: i.email.id, p_subject: i.email.subject, p_body: i.email.body, p_edit_ratio: 0, p_note: "Approved in bulk: every check passed", ...(deliverTo ? { p_deliver_to: deliverTo } : {}) });
        approved += 1;
      } catch {
        // A draft decided elsewhere in the meantime is fine to skip; the next page load shows the truth.
      }
    }
    refresh();
    return { ok: true, approved, message: `Approved ${approved} clean ${approved === 1 ? "draft" : "drafts"}. Each was checked against all twelve rules.` };
  } catch (e) {
    return { ok: false, approved: 0, message: ERR(e) };
  }
}
