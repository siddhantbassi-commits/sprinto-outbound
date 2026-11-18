import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { INTRO_COOKIE, wantsIntro } from "@/lib/app/enter";
import { readEnv } from "@/lib/env";

/**
 * Runs before every page. It does two jobs: gives each request a fresh nonce for a strict Content Security Policy (scripts
 * run only if they carry it), and keeps the Supabase session fresh, sending anyone without one to the sign-in page.
 * The pages check the session again themselves; this is the early, cheap check, not the only one.
 */

const PUBLIC = [/^\/login(\/|$)/, /^\/auth\//, /^\/api\/worker\//, /^\/api\/guest\//, /^\/enter(\/|$)/];

export async function proxy(request: NextRequest) {
  const env = readEnv();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'" + (dev ? " ws:" : ""),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  // The public demo opens with a short welcome while the sample workspace starts, once per browser session.
  if (wantsIntro({ mode: env.mode, method: request.method, hasCookie: request.cookies.has(INTRO_COOKIE), accept: request.headers.get("accept") ?? "", path: request.nextUrl.pathname })) {
    const to = request.nextUrl.clone();
    to.search = `?to=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    to.pathname = "/enter";
    return NextResponse.redirect(to);
  }

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  let response = NextResponse.next({ request: { headers } });

  if (env.mode === "supabase" && env.supabase && !PUBLIC.some((p) => p.test(request.nextUrl.pathname))) {
    const supabase = createServerClient(env.supabase.url, env.supabase.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      if (env.guest) {
        // The guest pass: no sign-in. A first visit gets the short welcome, then the page they asked for, as a guest.
        if (wantsIntro({ mode: "guest", method: request.method, hasCookie: request.cookies.has(INTRO_COOKIE), accept: request.headers.get("accept") ?? "", path: request.nextUrl.pathname })) {
          const to = request.nextUrl.clone();
          to.search = `?to=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
          to.pathname = "/enter";
          return NextResponse.redirect(to);
        }
      } else {
        const to = request.nextUrl.clone();
        to.pathname = "/login";
        to.search = "";
        return NextResponse.redirect(to);
      }
    }
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
