import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authUrl, exchangeBody, newState, parseCallback, pkce, readExchange, SEND_SCOPE } from "@/lib/smoke/oauth";

describe("pkce and state", () => {
  it("makes a challenge that is the hash of its verifier, and different every time", () => {
    const a = pkce();
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce().verifier).not.toBe(a.verifier);
    expect(newState()).not.toBe(newState());
  });
});

describe("authUrl", () => {
  const url = new URL(authUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:5555", state: "st", challenge: "ch", loginHint: "me@x.com" }));
  const q = url.searchParams;
  it("asks for the send scope and nothing else", () => {
    expect(q.get("scope")).toBe(SEND_SCOPE);
    expect(SEND_SCOPE).toBe("https://www.googleapis.com/auth/gmail.send");
  });
  it("asks for a refresh token every time, with PKCE and state", () => {
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toBe("ch");
    expect(q.get("state")).toBe("st");
    expect(q.get("response_type")).toBe("code");
  });
  it("comes back to the local address only, and hints which account", () => {
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:5555");
    expect(q.get("login_hint")).toBe("me@x.com");
    expect(url.origin).toBe("https://accounts.google.com");
  });
});

describe("parseCallback", () => {
  it("takes the code when the state matches", () => {
    expect(parseCallback("?code=abc&state=st", "st")).toEqual({ ok: true, code: "abc" });
  });
  it("ignores a callback with the wrong or missing state", () => {
    expect(parseCallback("?code=abc&state=other", "st").ok).toBe(false);
    expect(parseCallback("?code=abc", "st").ok).toBe(false);
  });
  it("explains a declined sign-in and a missing code", () => {
    expect(parseCallback("?error=access_denied&state=st", "st")).toEqual({ ok: false, message: "Access was declined on Google's page, so nothing was saved." });
    expect(parseCallback("?state=st", "st")).toEqual({ ok: false, message: "Google did not send a code." });
  });
});

describe("exchangeBody", () => {
  it("is an authorization-code exchange carrying the verifier", () => {
    const b = exchangeBody({ clientId: "c", clientSecret: "s", code: "k", redirectUri: "http://127.0.0.1:1", verifier: "v" });
    expect(Object.fromEntries(b)).toEqual({ client_id: "c", client_secret: "s", code: "k", redirect_uri: "http://127.0.0.1:1", grant_type: "authorization_code", code_verifier: "v" });
  });
});

describe("readExchange", () => {
  const good = { refresh_token: "r".repeat(40), scope: SEND_SCOPE, access_token: "a" };
  it("accepts a refresh token that can only send", () => {
    expect(readExchange(200, good)).toEqual({ ok: true, refreshToken: "r".repeat(40) });
  });
  it("tolerates the harmless identity scopes Google may add", () => {
    expect(readExchange(200, { ...good, scope: `${SEND_SCOPE} openid https://www.googleapis.com/auth/userinfo.email` }).ok).toBe(true);
  });
  it("refuses a token that cannot send", () => {
    const r = readExchange(200, { ...good, scope: "https://www.googleapis.com/auth/userinfo.email" });
    expect(r.ok).toBe(false);
  });
  it("refuses a token that could do more than send, such as read mail", () => {
    const r = readExchange(200, { ...good, scope: `${SEND_SCOPE} https://www.googleapis.com/auth/gmail.readonly` });
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toContain("more than permission to send");
  });
  it("refuses when no refresh token came back, and says how to get one", () => {
    const r = readExchange(200, { scope: SEND_SCOPE, access_token: "a" });
    expect((r as { message: string }).message).toContain("connected apps");
  });
  it("explains the common failures", () => {
    expect((readExchange(401, { error: "invalid_client" }) as { message: string }).message).toContain("Desktop app");
    expect((readExchange(400, { error: "invalid_grant" }) as { message: string }).message).toContain("Run the helper again");
    expect(readExchange(500, null).ok).toBe(false);
  });
  it("never puts a token in a message", () => {
    const msgs = [readExchange(200, { scope: "x", refresh_token: "SECRETTOKEN".repeat(5) }), readExchange(200, { scope: SEND_SCOPE, refresh_token: "short" })].map((r) => JSON.stringify(r));
    for (const m of msgs) expect(m).not.toContain("SECRETTOKEN");
  });
});
