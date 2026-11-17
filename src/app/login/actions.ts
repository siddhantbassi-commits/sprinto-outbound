"use server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { linkNotSent, redirectBase } from "@/lib/app/login";
import { readEnv } from "@/lib/env";

/**
 * Sends a one-time sign-in link. Accounts are never created here (shouldCreateUser is false), and the answer is the same
 * whether or not the address is known, so the form cannot be used to find out who has been invited.
 */
export async function requestLink(formData: FormData) {
  const env = readEnv();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  let notSent = false;
  if (env.supabase && /^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) && email.length <= 254) {
    const store = await cookies();
    // The cookies must really be written: the one-time code verifier for this sign-in is saved in one, and the callback
    // cannot turn the emailed code into a session without it.
    const supabase = createServerClient(env.supabase.url, env.supabase.anonKey, {
      cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
    });
    const base = redirectBase(env.appUrl, process.env.NODE_ENV);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: base ? `${base}/auth/callback` : undefined } });
    notSent = linkNotSent(error);
  }
  redirect(notSent ? "/login?error=send" : "/login?sent=1");
}
