"use server";
import { revalidatePath } from "next/cache";
import { currentSettings } from "@/lib/app/queries";
import { guestPayVerdict, guestSerial } from "@/lib/app/guest-load";
import { discoverySetup, getSession, hunterBalance } from "@/lib/app/runtime";
import { HunterError } from "@/lib/contacts/hunter";

export interface VerifyResult {
  ok: boolean;
  message: string;
}

/**
 * Checks the chosen contact's address with Hunter's verifier, on purpose, because it costs a credit. It will not run if that
 * would dig into the reserve, and the answer is kept as a permanent row (the status and score only, never the address).
 */
async function verifyNow(prospectId: string): Promise<VerifyResult> {
  const s = await getSession();
  if (!s || (s.user.role !== "operator" && s.user.role !== "admin")) return { ok: false, message: "Only an operator or admin can verify an address." };
  const may = await guestPayVerdict(s);
  if (!may.ok) return { ok: false, message: may.message };
  const setup = discoverySetup();
  if (!setup.ok || !setup.hunter.verify) return { ok: false, message: "Hunter is not connected, so the address cannot be checked." };
  const [contact] = await s.db.select("contacts", { prospect_id: prospectId, chosen: true }, { limit: 1 });
  const email = contact?.email ? String(contact.email) : "";
  if (!contact || !email) return { ok: false, message: "There is no address to check for this company." };

  const settings = await currentSettings(s.db);
  const reserve = settings?.hunter_reserve ?? 3;
  const balance = await hunterBalance();
  if (balance && "error" in balance && balance.error) return { ok: false, message: `Could not read Hunter's balance, so nothing was spent. ${balance.error}` };
  if (balance && typeof balance.remaining === "number" && balance.remaining - reserve < 1) {
    return { ok: false, message: `Hunter has ${balance.remaining} credits left and ${reserve} are kept in reserve, so there is nothing to spend on this.` };
  }

  try {
    const r = await setup.hunter.verify(email);
    await s.db.rpc("record_verification", { p_contact: contact.id, p_status: r.status, p_score: r.score, p_credits: 1 });
    revalidatePath(`/prospects/${prospectId}/brief`);
    const said = r.status === "valid" ? "The address is valid." : r.status === "invalid" ? "The address is invalid. Do not use it." : `Hunter still cannot vouch for it (${r.status.replace("_", " ")}).`;
    return { ok: r.status === "valid", message: `${said} That used 1 Hunter credit.` };
  } catch (e) {
    return { ok: false, message: e instanceof HunterError || e instanceof Error ? e.message : "The address could not be checked." };
  }
}

/** A guest's paid checks go one at a time, so two at once cannot both pass the same daily cap; a signed-in person is not held up. */
export async function verifyContact(prospectId: string): Promise<VerifyResult> {
  const s = await getSession();
  return s?.guest ? guestSerial("pay", () => verifyNow(prospectId)) : verifyNow(prospectId);
}
