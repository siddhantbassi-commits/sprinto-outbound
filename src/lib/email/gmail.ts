import { assertAddress, buildMessage, MimeError, toRaw } from "./mime";

/**
 * Sending, in test mode only. `sendTest` takes a draft and no recipient: the To address is the server's own setting,
 * fixed when the sender is built, so there is no code path where a contact's address becomes a recipient.
 *
 * A reviewer may also receive the test email at their own address. That is a separate, narrower path: `sendToReviewer` takes an
 * address, but the worker only ever passes the one the database recorded with the approval, and the database records one only
 * after the reviewer entered a code sent to it. `sendCode` sends that code. Neither is ever given a contact's address.
 *
 * Three outcomes, and the difference matters:
 *  - sent: Gmail confirmed and gave a message id.
 *  - failed: Gmail refused before sending (bad token, bad request, limits). Nothing went out; retrying is safe if retryable.
 *  - unknown: the request may have reached Gmail (timeout, 5xx, dropped connection). It is NEVER retried automatically,
 *    because it might have sent. A person checks Sent for the X-Outbound-Run header.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface Draft {
  subject: string;
  body: string;
  /** The same email laid out as HTML. Optional: without it the message is plain text only. */
  html?: string;
  /** Appears as the X-Outbound-Run header, for finding an unknown send by hand. */
  runId: string;
}

export type FailureCode = "reauthorize" | "bad_client" | "bad_request" | "rate_limited" | "token_unavailable" | "invalid_message" | "forbidden";

export type SendOutcome =
  | { status: "sent"; messageId: string; threadId: string | null }
  | { status: "failed"; code: FailureCode; retryable: boolean; reason: string }
  | { status: "unknown"; reason: string };

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: string;
  fromName?: string;
  /** The only address this sender can ever mail. */
  testTo: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface GmailSender {
  /** The fixed recipient, for display. */
  readonly recipient: string;
  sendTest(draft: Draft): Promise<SendOutcome>;
  /** The same test email, to a reviewer address the database recorded after a code proved it. Optional so a stand-in need not have it. */
  sendToReviewer?(to: string, draft: Draft): Promise<SendOutcome>;
  /** The one-line message carrying a confirmation code. */
  sendCode?(to: string, code: string): Promise<SendOutcome>;
}

interface Token {
  value: string;
  expiresAt: number;
}

type Json = Record<string, unknown>;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

export function createGmailSender(cfg: GmailConfig): GmailSender {
  const fetchFn = cfg.fetchFn ?? fetch;
  const now = cfg.now ?? Date.now;
  const timeoutMs = cfg.timeoutMs ?? 15_000;
  const clean = (s: string) => s.replace(/\s+/g, "");
  const clientId = clean(cfg.clientId);
  const clientSecret = clean(cfg.clientSecret);
  const refreshToken = clean(cfg.refreshToken);
  if (!clientId || !clientSecret || !refreshToken) throw new MimeError("Gmail credentials are incomplete");
  const from = assertAddress("From", cfg.from.trim());
  const testTo = assertAddress("Test recipient", cfg.testTo.trim());
  let token: Token | null = null;

  type TokenResult = { ok: true; token: string } | { ok: false; outcome: SendOutcome };

  async function accessToken(force = false): Promise<TokenResult> {
    if (!force && token && token.expiresAt - 60_000 > now()) return { ok: true, token: token.value };
    let res: Response;
    try {
      res = await fetchFn(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Nothing has been sent yet, so this is a clean failure that can be retried.
      return { ok: false, outcome: { status: "failed", code: "token_unavailable", retryable: true, reason: "Could not reach Google to sign in." } };
    }
    const body = (await res.json().catch(() => null)) as Json | null;
    if (res.ok && typeof body?.access_token === "string") {
      const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
      token = { value: body.access_token, expiresAt: now() + seconds * 1000 };
      return { ok: true, token: token.value };
    }
    token = null;
    const error = typeof body?.error === "string" ? body.error : "";
    if (error === "invalid_grant") return { ok: false, outcome: { status: "failed", code: "reauthorize", retryable: false, reason: "Gmail's sign-in expired or was revoked. Run the token helper again and update the refresh token." } };
    if (error === "invalid_client" || error === "unauthorized_client") return { ok: false, outcome: { status: "failed", code: "bad_client", retryable: false, reason: "Google refused the OAuth client. Check the client id and secret." } };
    return { ok: false, outcome: { status: "failed", code: "token_unavailable", retryable: res.status >= 500 || res.status === 429, reason: "Google would not give a sign-in token." } };
  }

  async function post(raw: string, bearer: string): Promise<Response> {
    return fetchFn(SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async function deliver(to: string, draft: Draft): Promise<SendOutcome> {
    let raw: string;
    try {
      // Only these four fields are read from the draft. Anything else on the object, a `to` included, is ignored.
      raw = toRaw(buildMessage({ from, fromName: cfg.fromName, to, subject: draft.subject, body: draft.body, html: draft.html, runId: draft.runId, unsubscribe: from, date: new Date(now()) }));
    } catch (e) {
      return { status: "failed", code: "invalid_message", retryable: false, reason: e instanceof MimeError ? e.message : "The message could not be built." };
    }

    let t = await accessToken();
    if (!t.ok) return t.outcome;
    let res: Response;
    try {
      res = await post(raw, t.token);
      if (res.status === 401) {
        // An expired token is refused before anything is sent, so one fresh token and one more try is safe.
        t = await accessToken(true);
        if (!t.ok) return t.outcome;
        res = await post(raw, t.token);
      }
    } catch (e) {
      // The request may have reached Gmail before the connection failed. Do not guess: it is unknown.
      return { status: "unknown", reason: isTimeout(e) ? "Gmail did not answer in time, so the message may or may not have been sent." : "The connection to Gmail dropped, so the message may or may not have been sent." };
    }

    const body = (await res.json().catch(() => null)) as Json | null;
    if (res.ok) {
      if (typeof body?.id === "string") return { status: "sent", messageId: body.id, threadId: typeof body.threadId === "string" ? body.threadId : null };
      return { status: "unknown", reason: "Gmail answered but did not confirm a message id, so the message may have been sent." };
    }
    if (res.status >= 500) return { status: "unknown", reason: `Gmail answered with a server error (${res.status}), so the message may or may not have been sent.` };

    const reason = typeof (body?.error as Json | undefined)?.status === "string" ? ((body!.error as Json).status as string) : "";
    if (res.status === 429 || (res.status === 403 && /rate|quota|limit/i.test(JSON.stringify((body?.error as Json | undefined)?.errors ?? reason)))) {
      return { status: "failed", code: "rate_limited", retryable: true, reason: "Gmail's sending limit was reached. Try again later." };
    }
    if (res.status === 401 || res.status === 403) return { status: "failed", code: res.status === 401 ? "reauthorize" : "forbidden", retryable: false, reason: "Gmail refused permission to send. Check the OAuth scope and account." };
    return { status: "failed", code: "bad_request", retryable: false, reason: `Gmail rejected the message (${res.status}).` };
  }

  const invalid = (e: unknown): SendOutcome => ({ status: "failed", code: "invalid_message", retryable: false, reason: e instanceof MimeError ? e.message : "The message could not be built." });

  return {
    recipient: testTo,

    sendTest: (draft: Draft) => deliver(testTo, draft),

    async sendToReviewer(to: string, draft: Draft): Promise<SendOutcome> {
      let address: string;
      try {
        address = assertAddress("Reviewer address", String(to).trim().toLowerCase());
      } catch (e) {
        return invalid(e);
      }
      return deliver(address, draft);
    },

    async sendCode(to: string, code: string): Promise<SendOutcome> {
      let address: string;
      try {
        address = assertAddress("Reviewer address", String(to).trim().toLowerCase());
        if (!/^\d{6}$/.test(code)) throw new MimeError("The code must be six digits");
      } catch (e) {
        return invalid(e);
      }
      return deliver(address, {
        subject: `Your Sprinto Outbound review code: ${code}`,
        body: `Your code is ${code}.\n\nIt lasts 15 minutes. Enter it on the Review page of Sprinto Outbound and the test emails you approve there will be delivered to this address.\n\nIf you did not ask for this, ignore it. Nothing is sent to you unless the code is entered, and the code is useless to anyone else.`,
        runId: "reviewer-code",
      });
    },
  };
}
