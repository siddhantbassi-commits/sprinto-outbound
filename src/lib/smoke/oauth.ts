/**
 * The pure parts of the one-off Gmail sign-in: PKCE, the address to send the person to, reading what Google sends back,
 * and the request that turns the code into a refresh token. The script around it only opens a local door and writes the
 * token to .env.local. Only the send scope is ever asked for, so the token cannot read mail.
 */
import { createHash, randomBytes } from "node:crypto";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const b64url = (b: Buffer) => b.toString("base64url");

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function pkce(): Pkce {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export const newState = () => b64url(randomBytes(24));

export function authUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: SEND_SCOPE,
    // Offline access and a forced consent screen are what make Google hand back a refresh token every time.
    access_type: "offline",
    prompt: "consent",
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
  });
  if (o.loginHint) q.set("login_hint", o.loginHint);
  return `${AUTH_URL}?${q.toString()}`;
}

export type Callback = { ok: true; code: string } | { ok: false; message: string };

/** What came back on the local address. The state must match what was sent, or something else is knocking. */
export function parseCallback(search: string, expectedState: string): Callback {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const error = q.get("error");
  if (error) return { ok: false, message: error === "access_denied" ? "Access was declined on Google's page, so nothing was saved." : `Google reported: ${error}.` };
  if (q.get("state") !== expectedState) return { ok: false, message: "The sign-in did not match the one that was started, so it was ignored." };
  const code = q.get("code");
  return code ? { ok: true, code } : { ok: false, message: "Google did not send a code." };
}

export function exchangeBody(o: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string }): URLSearchParams {
  return new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, code: o.code, redirect_uri: o.redirectUri, grant_type: "authorization_code", code_verifier: o.verifier });
}

export type Exchange = { ok: true; refreshToken: string } | { ok: false; message: string };

/** Judges Google's answer. A token without the send scope, or without a refresh token, is refused here, not discovered later. */
export function readExchange(status: number, body: unknown): Exchange {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status < 200 || status >= 300) {
    const e = String(b.error ?? "");
    if (e === "invalid_client") return { ok: false, message: "Google refused the OAuth client. Check the client ID and secret belong together, and that the client type is Desktop app." };
    if (e === "invalid_grant") return { ok: false, message: "The code was already used or has expired. Run the helper again." };
    return { ok: false, message: `Google would not give a token${e ? ` (${e})` : ""}.` };
  }
  const scopes = String(b.scope ?? "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(SEND_SCOPE)) return { ok: false, message: `The token does not carry the send scope (it has: ${scopes.join(", ") || "none listed"}). Nothing was saved.` };
  if (scopes.some((s) => s !== SEND_SCOPE && !/^(openid|email|profile|https:\/\/www\.googleapis\.com\/auth\/userinfo\.(email|profile))$/.test(s))) return { ok: false, message: `The token carries more than permission to send (${scopes.join(", ")}). Nothing was saved.` };
  const refreshToken = typeof b.refresh_token === "string" ? b.refresh_token : "";
  if (refreshToken.length < 20) return { ok: false, message: "Google did not send a refresh token. Remove this app from your Google account's connected apps and run the helper again." };
  return { ok: true, refreshToken };
}
