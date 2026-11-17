import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";

/** POST only, so a link or an image on another site cannot sign anyone out. */
export async function POST(request: NextRequest) {
  const env = readEnv();
  if (env.supabase) {
    const store = await cookies();
    const supabase = createServerClient(env.supabase.url, env.supabase.anonKey, {
      cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
    });
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, 303);
}
