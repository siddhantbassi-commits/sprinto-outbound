/**
 * One-off: sign in to Google once, in your own browser, so the app can send mail as you. Run it after
 * `npm run keys -- --only gmail` (client ID, client secret and sender address).
 *
 *   npm run gmail-token
 *
 * It opens a local address on this machine only, sends you to Google, and receives the answer there. The refresh token goes
 * straight into .env.local (readable by you alone) and is never printed. Only permission to SEND is requested, so the token
 * cannot read your mail.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { mergeEnv, parseEnv } from "@/lib/smoke/envfile";
import { authUrl, exchangeBody, newState, parseCallback, pkce, readExchange, TOKEN_URL } from "@/lib/smoke/oauth";

const FILE = process.env.SMOKE_ENV_FILE ?? ".env.local";
const WAIT_MS = 5 * 60_000;

async function main() {
  const text = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
  const env = parseEnv(text);
  const clientId = env.GMAIL_CLIENT_ID ?? "";
  const clientSecret = env.GMAIL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are not set. Run `npm run keys -- --only gmail` first.");

  const { verifier, challenge } = pkce();
  const state = newState();

  const result = await new Promise<{ ok: true; code: string; redirectUri: string } | { ok: false; message: string }>((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      // A request that does not carry our state is not Google answering us. Turn it away and keep waiting.
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("This is not the sign-in that was started.");
        return;
      }
      const cb = parseCallback(url.search, state);
      res.writeHead(cb.ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
      res.end(cb.ok ? "Signed in. You can close this tab and go back to the terminal." : `${cb.message}\nYou can close this tab and go back to the terminal.`);
      clearTimeout(timer);
      server.close();
      resolve(cb.ok ? { ok: true, code: cb.code, redirectUri: redirect } : cb);
    });
    let redirect = "";
    const timer = setTimeout(() => {
      server.close();
      resolve({ ok: false, message: "No answer from Google within five minutes. Run the helper again when you are ready." });
    }, WAIT_MS);
    // Port 0 lets the system pick a free one. Listening on 127.0.0.1 means nothing outside this machine can reach it.
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      redirect = `http://127.0.0.1:${port}`;
      const url = authUrl({ clientId, redirectUri: redirect, state, challenge, loginHint: env.GMAIL_FROM || undefined });
      console.log("\nOpen this address in your browser and sign in as the account that should send the mail:\n");
      console.log(`  ${url}\n`);
      console.log("Waiting for Google (up to five minutes). Nothing is saved until it succeeds.");
      if (process.platform === "darwin" && !process.env.NO_OPEN) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    });
  });
  if (!result.ok) throw new Error(result.message);

  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: exchangeBody({ clientId, clientSecret, code: result.code, redirectUri: result.redirectUri, verifier }) });
  const exchange = readExchange(res.status, await res.json().catch(() => null));
  if (!exchange.ok) throw new Error(exchange.message);

  writeFileSync(FILE, mergeEnv(text, { GMAIL_REFRESH_TOKEN: exchange.refreshToken }), { mode: 0o600 });
  chmodSync(FILE, 0o600);
  console.log(`\n✓ Saved GMAIL_REFRESH_TOKEN to ${FILE} (${exchange.refreshToken.length} characters, not shown). It can only send mail.\nNext: npm run smoke -- --send   (sends one test email to your test address)`);
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : "Stopped."}`);
  process.exit(1);
});
