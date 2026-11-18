/**
 * The public front door, for the demo and for the guest pass. A visitor following the link first lands on a short welcome animation while the
 * workspace starts up behind it, then goes to the page they asked for. These two rules decide when that happens and where it
 * ends, and are pure so they are tested: the welcome is shown once per browser session, only for a page being opened (never an
 * API call, an action, or a prefetch), and it can only ever lead to a page inside the app.
 */

export const INTRO_COOKIE = "sprinto_intro";

/** Where the welcome may lead: a path inside the app. Anything else, including a link to another site, becomes the home page. */
export function safeDestination(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (t === "" || t.length > 300 || !/^\/(?![/\\])/.test(t) || /[\u0000-\u001f]/.test(t)) return "/";
  if (/^\/(enter|api|auth|login)(\/|\?|$)/.test(t)) return "/";
  return t;
}

export interface IntroRequest {
  /** "guest" is a visitor with no sign-in on an app that has the guest pass switched on. */
  mode: "demo" | "supabase" | "guest";
  method: string;
  hasCookie: boolean;
  accept: string;
  path: string;
}

/** True when this request is someone opening a page in the demo for the first time this session. */
export function wantsIntro(r: IntroRequest): boolean {
  if ((r.mode !== "demo" && r.mode !== "guest") || r.method !== "GET" || r.hasCookie) return false;
  if (!r.accept.includes("text/html")) return false;
  return !/^\/(enter|api|auth|login)(\/|$)/.test(r.path);
}
