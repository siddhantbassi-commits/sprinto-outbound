"use server";
import { revalidatePath } from "next/cache";
import { getSession, type AppSession } from "@/lib/app/runtime";
import { isPlainAddress } from "@/lib/email/mime";
import { isUsableFirstName } from "@/lib/pitch/draft";
import { countToday, guestMayResume } from "@/lib/app/guest";
import { guestSerial, guestUsage } from "@/lib/app/guest-load";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const ERR = (e: unknown) => (e instanceof Error ? e.message : "That did not work.");
const reasonOf = (f: FormData) => String(f.get("reason") ?? "").trim().slice(0, 300);

async function operator(): Promise<AppSession | null> {
  const s = await getSession();
  return s && (s.user.role === "operator" || s.user.role === "admin") ? s : null;
}

/** Puts a parked prospect back in the queue. The database records the decision and refuses lanes that must not be resumed. */
export async function resume(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can do that." };
  const id = String(f.get("id") ?? "");
  if (reasonOf(f).length < 3) return { ok: false, message: "Give a short reason (at least 3 characters)." };
  const kind = f.get("kind") === "rerun" ? "rerun" : "promote";
  const put = async (): Promise<ActionResult | null> => {
    // A guest has a daily number of these, since each spends model time and maybe a Hunter credit; checked and recorded in one step.
    if (s.guest) {
      const [usage, decisions] = await Promise.all([guestUsage(s), s.db.select("decisions", {}, { order: "seq", ascending: false, limit: 500 })]);
      const verdict = guestMayResume(usage, s.env.guest!, countToday(decisions, s.user.id, Date.now(), ["promote", "rerun"]));
      if (!verdict.ok) return { ok: false, message: verdict.message };
    }
    try {
      await s.db.rpc("resume_prospect", { p_prospect: id, p_reason: reasonOf(f), p_kind: kind });
    } catch (e) {
      return { ok: false, message: ERR(e) };
    }
    return null;
  };
  const refused = s.guest ? await guestSerial("resume", put) : await put();
  if (refused) return refused;
  revalidatePath(`/prospects/${id}`);
  revalidatePath("/review");
  return { ok: true, message: "Back in the queue. The worker will pick it up." };
}

/** After checking Sent for the X-Outbound-Run header, a person says whether the email really went out. Nothing automatic can. */
export async function resolveUnknown(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can do that." };
  const id = String(f.get("id") ?? "");
  const outcome = f.get("outcome") === "sent" ? "sent" : "failed";
  if (reasonOf(f).length < 3) return { ok: false, message: "Say what you checked (at least 3 characters)." };
  try {
    const emails = await s.db.select("emails", { prospect_id: id, status: "unknown" });
    const email = emails[0];
    if (!email) return { ok: false, message: "There is no unknown send to resolve." };
    await s.db.rpc("set_email_status", { p_email: email.id, p_status: outcome, p_message_id: String(f.get("message_id") ?? "").trim().slice(0, 100) || null, p_thread_id: null, p_error: outcome === "failed" ? "Checked Sent: not found" : null, p_retryable: false, p_reason: reasonOf(f) });
  } catch (e) {
    return { ok: false, message: ERR(e) };
  }
  revalidatePath(`/prospects/${id}`);
  revalidatePath("/review");
  return { ok: true, message: outcome === "sent" ? "Recorded as sent." : "Recorded as not sent." };
}

/** Adds the domain to the do-not-contact list. Lifting it later is a new row, never an edit. */
export async function doNotContact(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can do that." };
  const domain = String(f.get("domain") ?? "").trim().toLowerCase();
  if (reasonOf(f).length < 3) return { ok: false, message: "Give a short reason (at least 3 characters)." };
  try {
    await s.db.insert("suppressions", { kind: "domain", value: domain, action: "add", reason: reasonOf(f) });
  } catch (e) {
    return { ok: false, message: ERR(e) };
  }
  revalidatePath(`/prospects/${String(f.get("id") ?? "")}`);
  revalidatePath("/settings");
  return { ok: true, message: `${domain} will not be contacted.` };
}

/** A hand-picked contact (an Apollo lookup, say). It outranks anything Hunter finds for the same domain. */
export async function addContact(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can do that." };
  const domain = String(f.get("domain") ?? "").trim().toLowerCase();
  const first = String(f.get("first_name") ?? "").trim();
  const last = String(f.get("last_name") ?? "").trim().slice(0, 60);
  const position = String(f.get("position") ?? "").trim().slice(0, 80);
  const email = String(f.get("email") ?? "").trim();
  if (!isUsableFirstName(first)) return { ok: false, message: "Enter a first name (letters only)." };
  if (!isPlainAddress(email)) return { ok: false, message: "Enter one plain email address." };
  if (!email.toLowerCase().endsWith(`@${domain}`) && !email.toLowerCase().endsWith(`.${domain}`)) return { ok: false, message: `The address should be at ${domain}.` };
  if (position.length < 2) return { ok: false, message: "Enter the person's job title." };
  try {
    await s.db.insert("manual_contacts", { domain, first_name: first, last_name: last || null, position, email });
  } catch (e) {
    return { ok: false, message: ERR(e) };
  }
  revalidatePath(`/prospects/${String(f.get("id") ?? "")}`);
  return { ok: true, message: "Saved. Use “Try again” on this prospect so it is looked up with this contact." };
}
