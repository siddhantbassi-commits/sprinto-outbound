import { createGmailSender } from "@/lib/email/gmail";
import { isPlainAddress } from "@/lib/email/mime";
import { fail, pass, safely, skip, warn, type Check } from "./report";

const S = "gmail";
const SEND = "https://www.googleapis.com/auth/gmail.send";

export interface GmailSmokeOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: string;
  testTo: string;
  /** Actually send one email to testTo. */
  send: boolean;
  fetchFn?: typeof fetch;
}

export async function gmailChecks(o: GmailSmokeOptions): Promise<Check[]> {
  const fetchFn = o.fetchFn ?? fetch;
  const out: Check[] = [];

  out.push(
    ...(await safely(S, "addresses", "The sender and the test address are plain addresses", async () => {
      if (!isPlainAddress(o.from)) return fail(S, "addresses", "The sender and the test address are plain addresses", "GMAIL_FROM is not one plain email address");
      if (!isPlainAddress(o.testTo)) return fail(S, "addresses", "The sender and the test address are plain addresses", "OUTBOUND_TEST_TO is not one plain email address");
      return o.from.toLowerCase() === o.testTo.toLowerCase()
        ? pass(S, "addresses", "The sender and the test address are plain addresses", "you send to yourself, which is what test mode is for")
        : warn(S, "addresses", "The sender and the test address are plain addresses", "the sender and the test address differ", "That is allowed, but confirm the test address is an inbox you read.");
    })),
  );

  out.push(
    ...(await safely(S, "token", "The refresh token can be exchanged for an access token", async () => {
      const res = await fetchFn("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken, grant_type: "refresh_token" }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; expires_in?: number; error?: string };
      if (res.ok && body.access_token) {
        const scopes = (body.scope ?? "").split(/\s+/).filter(Boolean);
        const reminder = "If your OAuth consent screen is External and in Testing, this refresh token expires after 7 days. Use an Internal app (Google Workspace) or re-run the token helper before each demo.";
        if (!scopes.includes(SEND)) return fail(S, "token", "The refresh token can be exchanged for an access token", `it works, but it does not carry the send scope (it has: ${scopes.join(", ") || "none listed"})`, "Create the token again with the gmail.send scope.");
        const extra = scopes.filter((s) => s !== SEND);
        if (extra.length) return warn(S, "token", "The refresh token can be exchanged for an access token", `works, but the token is broader than needed: ${extra.join(", ")}`, `Send-only is the safer choice: re-create it with just ${SEND}. ${reminder}`);
        return pass(S, "token", "The refresh token can be exchanged for an access token", `works, send-only scope, access token good for ${body.expires_in ?? "?"} seconds`, reminder);
      }
      if (body.error === "invalid_grant") return fail(S, "token", "The refresh token can be exchanged for an access token", "Google says the token is expired or revoked (invalid_grant)", "Run the token helper again. If the app is External and in Testing, tokens last 7 days.");
      if (body.error === "invalid_client" || body.error === "unauthorized_client") return fail(S, "token", "The refresh token can be exchanged for an access token", `Google refused the OAuth client (${body.error})`, "Check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET belong to the same client as the token.");
      return fail(S, "token", "The refresh token can be exchanged for an access token", `Google answered HTTP ${res.status}${body.error ? ` (${body.error})` : ""}`);
    })),
  );

  if (!o.send) {
    out.push(skip(S, "send", "A real test email arrives", `not sent: this would put one email in ${o.testTo}`, "Add `--send` to send one, then check your inbox."));
    return out;
  }
  out.push(
    ...(await safely(S, "send", "A real test email arrives", async () => {
      const sender = createGmailSender({ clientId: o.clientId, clientSecret: o.clientSecret, refreshToken: o.refreshToken, from: o.from, testTo: o.testTo, fetchFn });
      const runId = `smoke-${Date.now()}`;
      const r = await sender.sendTest({ subject: "Sprinto Outbound: smoke test", body: "This is the smoke test for Sprinto Outbound. If you can read it, sending works.\n\nIt was sent to you only, as test mode always does.", runId });
      if (r.status === "sent") return pass(S, "send", "A real test email arrives", `Gmail accepted it as message ${r.messageId}. Check ${o.testTo} (and spam) for "Sprinto Outbound: smoke test".`);
      if (r.status === "unknown") return warn(S, "send", "A real test email arrives", r.reason, `Search your Sent folder for the header X-Outbound-Run: ${runId}`);
      return fail(S, "send", "A real test email arrives", r.reason, r.code === "reauthorize" ? "Run the token helper again." : undefined);
    })),
  );
  return out;
}
