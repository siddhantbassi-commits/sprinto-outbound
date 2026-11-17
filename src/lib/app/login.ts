/**
 * Pieces of the sign-in flow that are decided by plain rules, kept apart from the Next.js action so they can be tested.
 */

/**
 * Where the emailed link should land. The configured address wins. Without one, local development falls back to
 * localhost; a production build never guesses (the link then goes to Supabase's own Site URL setting). The request's Host
 * header is never used, so a forged header cannot steer a sign-in link anywhere.
 */
export function redirectBase(appUrl: string | null, nodeEnv: string | undefined): string | null {
  if (appUrl) return appUrl.replace(/\/+$/, "");
  return nodeEnv === "production" ? null : "http://localhost:3000";
}

export interface AuthFailure {
  status?: number;
  code?: string;
}

/**
 * Should the person be told the link could not be sent? Only when the failure says nothing about who has been invited:
 * the mail service being rate-limited or down. "No such user" must look exactly like success, or the form would reveal
 * which addresses are invited.
 */
export function linkNotSent(e: AuthFailure | null | undefined): boolean {
  if (!e) return false;
  if (e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") return true;
  return (e.status ?? 0) >= 500;
}
