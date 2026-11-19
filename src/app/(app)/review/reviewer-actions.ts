"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { codeHash, CONFIRM_LIFE_MS, makeToken, maskAddress, newCode, normaliseAddress, normaliseCode, REVIEWER_COOKIE } from "@/lib/app/reviewer";
import { getSession, reviewerSetup } from "@/lib/app/runtime";

export interface ReviewerResult {
  ok: boolean;
  message: string;
  /** The address now confirmed, shown masked. */
  address?: string;
}

/** The database words its refusals for a person, so these pass through; anything else is hidden behind a plain sentence. */
const SAFE = /^(The reviewer inbox |Three codes have |Too many wrong codes|There is no code waiting|That is not a plain email|That address has not been confirmed)/;

function say(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return SAFE.test(m) ? m : "That did not work. Try again in a moment.";
}

async function operator() {
  const s = await getSession();
  return s && (s.user.role === "operator" || s.user.role === "admin") ? s : null;
}

/** Sends a six-digit code to the address the reviewer typed. Only a keyed hash of it is stored; the address gets the code itself. */
export async function requestReviewerCode(addressIn: string): Promise<ReviewerResult> {
  const setup = reviewerSetup();
  if (!setup?.gmail.sendCode) return { ok: false, message: "Sending test emails to your own address is switched off here." };
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can do this." };
  const address = normaliseAddress(addressIn);
  if (!address) return { ok: false, message: "Enter one plain email address, like name@school.edu." };
  const code = newCode();
  try {
    await s.db.rpc("request_reviewer_code", { p_address: address, p_code_hash: codeHash(setup.key, address, code) });
  } catch (e) {
    return { ok: false, message: say(e) };
  }
  const sent = await setup.gmail.sendCode(address, code);
  if (sent.status !== "sent") return { ok: false, message: "The code could not be sent just now. Check the address and try again." };
  return { ok: true, message: `A code was sent to ${maskAddress(address)}. It works for 15 minutes.` };
}

/** Checks the code. When it is right, this browser remembers the address for a day, and approved emails are delivered to it. */
export async function confirmReviewerCode(addressIn: string, codeIn: string): Promise<ReviewerResult> {
  const setup = reviewerSetup();
  if (!setup) return { ok: false, message: "Sending test emails to your own address is switched off here." };
  const s = await operator();
  if (!s) return { ok: false, message: "Only an operator or admin can do this." };
  const address = normaliseAddress(addressIn);
  const code = normaliseCode(codeIn);
  if (!address) return { ok: false, message: "Enter one plain email address, like name@school.edu." };
  if (!code) return { ok: false, message: "The code is six digits." };
  let right = false;
  try {
    right = Boolean(await s.db.rpc("confirm_reviewer_code", { p_address: address, p_code_hash: codeHash(setup.key, address, code) }));
  } catch (e) {
    return { ok: false, message: say(e) };
  }
  if (!right) return { ok: false, message: "That code is not right, or it has expired. Check it and try again, or ask for a new one." };
  (await cookies()).set(REVIEWER_COOKIE, makeToken(setup.key, address, Date.now() + CONFIRM_LIFE_MS), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: CONFIRM_LIFE_MS / 1000 });
  revalidatePath("/review");
  return { ok: true, address: maskAddress(address), message: `Confirmed. Approved test emails will now be delivered to ${maskAddress(address)}.` };
}

/** Goes back to the default: test emails go to the owner's address again. */
export async function clearReviewer(): Promise<ReviewerResult> {
  (await cookies()).delete(REVIEWER_COOKIE);
  revalidatePath("/review");
  return { ok: true, message: "Test emails will go to the owner's address again." };
}
