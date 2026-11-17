import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";

/** The sign-in link lands here with a one-time code, which becomes a session cookie. The redirect target is fixed, never taken from the request. */
export async function GET(request: NextRequest) {
  const env = readEnv();
  const code = request.nextUrl.searchParams.get("code");
  const base = request.nextUrl.origin;
  if (!env.supabase || !code) return NextResponse.redirect(`${base}/login?error=1`);
  const store = await cookies();
  const supabase = createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(error ? `${base}/login?error=1` : `${base}/`);
}
