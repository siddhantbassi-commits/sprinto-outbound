"use server";
import { revalidatePath } from "next/cache";
import { isOutcome, OUTCOME_BY_ID } from "@/lib/app/outcomes";
import { getSession } from "@/lib/app/runtime";

export interface OutcomeResult {
  ok: boolean;
  message: string;
}

/** Records what came of a lead. The database checks the role, the date, and what may go with what; this only reads the form. */
export async function logOutcome(_prev: OutcomeResult | null, formData: FormData): Promise<OutcomeResult> {
  const s = await getSession();
  if (!s || (s.user.role !== "operator" && s.user.role !== "admin")) return { ok: false, message: "Only an operator or admin can record an outcome." };
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isOutcome(status)) return { ok: false, message: "Choose what happened." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const rawDate = String(formData.get("follow_up") ?? "").trim();
  const followUp = OUTCOME_BY_ID[status].open && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  const dnc = status === "not_interested" && formData.get("dnc") === "on";
  try {
    await s.db.rpc("log_outcome", { p_prospect: id, p_status: status, p_note: note, p_follow_up: followUp, p_do_not_contact: dnc });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That could not be recorded." };
  }
  for (const p of ["/leads", `/prospects/${id}/brief`, "/impact", "/"]) revalidatePath(p);
  return { ok: true, message: dnc ? "Recorded, and they will not be contacted again." : "Recorded." };
}
