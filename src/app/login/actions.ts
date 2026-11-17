"use server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readEnv } from "@/lib/env";

/**
 * Sends a one-time sign-in link. Accounts are never created here (shouldCreateUser is false), and the answer is the same
 * whether or not the address is known, so the form cannot be used to find out who has been invited.
 */
export async function requestLink(formData: FormData) {
  const env = readEnv();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (env.supabase && /^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) && email.length <= 254) {
    const store = await cookies();
    const supabase = createServerClient(env.supabase.url, env.supabase.anonKey, { cookies: { getAll: () => store.getAll(), setAll: () => undefined } });
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: env.appUrl ? `${env.appUrl}/auth/callback` : undefined } });
  }
  redirect("/login?sent=1");
}
