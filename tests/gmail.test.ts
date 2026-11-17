import { describe, expect, it } from "vitest";
import { createGmailSender, type Draft, type GmailConfig } from "@/lib/email/gmail";
import { MimeError } from "@/lib/email/mime";

const SECRETS = { clientId: "client-id-123", clientSecret: "client-secret-ABC", refreshToken: "1//refresh-token-XYZ" };
const ME = "siddhant@pg27.mesaschool.co";
const DRAFT: Draft = { subject: "A question about SSO", body: "Hi Priya,\n\nHello.", runId: "run_42" };
const CONTACT = "priya@acme.com";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}
type Answer = Response | Error | ((init: RequestInit) => Promise<Response>);
const tokenOk = (token = "access-1", expires = 3600) => new Response(JSON.stringify({ access_token: token, expires_in: expires }), { status: 200 });
const sentOk = (id = "msg-1") => new Response(JSON.stringify({ id, threadId: "thr-1" }), { status: 200 });
const err = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

/** Answers each request in order, and records what was sent. */
function harness(answers: Answer[], over: Partial<GmailConfig> = {}) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetchFn = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body) });
    const next = queue.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(init) : next;
  }) as unknown as typeof fetch;
  let t = 1_800_000_000_000;
  const sender = createGmailSender({ ...SECRETS, from: ME, testTo: ME, fetchFn, now: () => t, ...over });
  const sends = () => calls.filter((c) => c.url.includes("messages/send"));
  const tokens = () => calls.filter((c) => c.url.includes("oauth2.googleapis.com"));
  return { sender, calls, sends, tokens, advance: (ms: number) => (t += ms) };
}
const rawOf = (call: Call) => Buffer.from((JSON.parse(call.body) as { raw: string }).raw, "base64url").toString("utf8");

describe("createGmailSender: set-up", () => {
  it("refuses incomplete credentials, a bad sender and a bad or multiple test recipient", () => {
    expect(() => createGmailSender({ ...SECRETS, refreshToken: " ", from: ME, testTo: ME })).toThrow(MimeError);
    expect(() => createGmailSender({ ...SECRETS, from: "nope", testTo: ME })).toThrow(MimeError);
    expect(() => createGmailSender({ ...SECRETS, from: ME, testTo: "a@b.com, c@d.com" })).toThrow(/single plain email/);
    expect(() => createGmailSender({ ...SECRETS, from: ME, testTo: "Name <a@b.com>" })).toThrow(MimeError);
  });

  it("cleans whitespace pasted into the credentials", async () => {
    const h = harness([tokenOk(), sentOk()], { clientSecret: "  client-secret-ABC\n", refreshToken: "1//refresh\n-token-XYZ " });
    await h.sender.sendTest(DRAFT);
    expect(new URLSearchParams(h.tokens()[0]!.body).get("refresh_token")).toBe("1//refresh-token-XYZ");
  });

  it("exposes only the fixed recipient", () => {
    expect(harness([]).sender.recipient).toBe(ME);
  });
});

describe("sendTest: the recipient is not the draft's to choose", () => {
  it("sends to the configured address and nobody else", async () => {
    const h = harness([tokenOk(), sentOk()]);
    await h.sender.sendTest(DRAFT);
    const raw = rawOf(h.sends()[0]!);
    expect(raw).toContain(`To: ${ME}\r\n`);
    expect(raw.match(/^(To|Cc|Bcc):/gim)).toEqual(["To:"]);
  });

  it("ignores a recipient smuggled onto the draft object at runtime", async () => {
    const h = harness([tokenOk(), sentOk()]);
    const sneaky = { ...DRAFT, to: CONTACT, cc: CONTACT, bcc: CONTACT, recipient: CONTACT, From: CONTACT } as unknown as Draft;
    await h.sender.sendTest(sneaky);
    const raw = rawOf(h.sends()[0]!);
    expect(raw).not.toContain(CONTACT);
    expect(raw.match(/^(To|Cc|Bcc):/gim)).toEqual(["To:"]);
  });

  it("cannot be given a recipient by the type system either", () => {
    const sender = harness([]).sender;
    // @ts-expect-error sendTest takes the draft only; a second argument is a compile error
    void (() => sender.sendTest(DRAFT, CONTACT));
    // @ts-expect-error a draft has no `to`
    void (() => sender.sendTest({ ...DRAFT, to: CONTACT }));
    expect(true).toBe(true);
  });

  it("refuses a draft whose subject could forge a header, without any network call", async () => {
    const h = harness([]);
    const out = await h.sender.sendTest({ ...DRAFT, subject: `Hello\r\nBcc: ${CONTACT}` });
    expect(out).toMatchObject({ status: "failed", code: "invalid_message", retryable: false });
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a bad run id without any network call", async () => {
    const h = harness([]);
    expect(await h.sender.sendTest({ ...DRAFT, runId: "x\r\nBcc: a@b.co" })).toMatchObject({ status: "failed", code: "invalid_message" });
    expect(h.calls).toHaveLength(0);
  });
});

describe("sendTest: the happy path", () => {
  it("refreshes a token with the send scope's refresh flow, then sends with it", async () => {
    const h = harness([tokenOk("access-1"), sentOk("msg-9")]);
    const out = await h.sender.sendTest(DRAFT);
    expect(out).toEqual({ status: "sent", messageId: "msg-9", threadId: "thr-1" });
    const form = new URLSearchParams(h.tokens()[0]!.body);
    expect([form.get("grant_type"), form.get("client_id"), form.get("client_secret")]).toEqual(["refresh_token", SECRETS.clientId, SECRETS.clientSecret]);
    expect(h.sends()[0]!.headers.Authorization).toBe("Bearer access-1");
    expect(h.sends()[0]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  });

  it("puts the run id in the message so a send can be found in Sent", async () => {
    const h = harness([tokenOk(), sentOk()]);
    await h.sender.sendTest(DRAFT);
    expect(rawOf(h.sends()[0]!)).toContain("X-Outbound-Run: run_42\r\n");
  });

  it("reuses the token until a minute before it expires, then refreshes", async () => {
    const h = harness([tokenOk("a", 3600), sentOk("m1"), sentOk("m2"), tokenOk("b", 3600), sentOk("m3")]);
    await h.sender.sendTest(DRAFT);
    h.advance(3_000_000);
    await h.sender.sendTest(DRAFT);
    expect(h.tokens()).toHaveLength(1);
    h.advance(600_000);
    await h.sender.sendTest(DRAFT);
    expect(h.tokens()).toHaveLength(2);
    expect(h.sends()[2]!.headers.Authorization).toBe("Bearer b");
  });

  it("tolerates a missing threadId", async () => {
    const h = harness([tokenOk(), new Response(JSON.stringify({ id: "m" }), { status: 200 })]);
    expect(await h.sender.sendTest(DRAFT)).toEqual({ status: "sent", messageId: "m", threadId: null });
  });
});

describe("sendTest: failures where nothing was sent", () => {
  it("reports an expired or revoked refresh token as needing re-authorisation, and does not try to send", async () => {
    const h = harness([err(400, { error: "invalid_grant" })]);
    const out = await h.sender.sendTest(DRAFT);
    expect(out).toMatchObject({ status: "failed", code: "reauthorize", retryable: false });
    expect((out as { reason: string }).reason).toMatch(/token helper/);
    expect(h.sends()).toHaveLength(0);
  });

  it("reports a bad OAuth client", async () => {
    expect(await harness([err(401, { error: "invalid_client" })]).sender.sendTest(DRAFT)).toMatchObject({ code: "bad_client", retryable: false });
  });

  it("treats a token outage or a network failure at sign-in as retryable, since nothing was sent", async () => {
    expect(await harness([err(503, {})]).sender.sendTest(DRAFT)).toMatchObject({ status: "failed", code: "token_unavailable", retryable: true });
    const h = harness([new TypeError("fetch failed")]);
    expect(await h.sender.sendTest(DRAFT)).toMatchObject({ status: "failed", code: "token_unavailable", retryable: true });
    expect(h.sends()).toHaveLength(0);
  });

  it("refreshes once and retries when Gmail says the token is stale", async () => {
    const h = harness([tokenOk("old"), err(401), tokenOk("new"), sentOk("m")]);
    expect(await h.sender.sendTest(DRAFT)).toMatchObject({ status: "sent", messageId: "m" });
    expect(h.sends().map((c) => c.headers.Authorization)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("gives up after that single retry rather than looping", async () => {
    const h = harness([tokenOk("old"), err(401), tokenOk("new"), err(401)]);
    expect(await h.sender.sendTest(DRAFT)).toMatchObject({ status: "failed", code: "reauthorize", retryable: false });
    expect(h.sends()).toHaveLength(2);
  });

  it.each([
    [400, { error: { status: "INVALID_ARGUMENT" } }, "bad_request", false],
    [404, {}, "bad_request", false],
    [429, {}, "rate_limited", true],
    [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "rate_limited", true],
    [403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } }, "rate_limited", true],
    [403, { error: { errors: [{ reason: "insufficientPermissions" }] } }, "forbidden", false],
  ])("treats a clear refusal (HTTP %i) as failed, not unknown", async (status, body, code, retryable) => {
    const out = await harness([tokenOk(), err(status, body)]).sender.sendTest(DRAFT);
    expect(out).toMatchObject({ status: "failed", code, retryable });
  });
});

describe("sendTest: failures where it may have been sent", () => {
  it.each([500, 502, 503, 504])("calls HTTP %i unknown, never failed", async (status) => {
    const out = await harness([tokenOk(), err(status)]).sender.sendTest(DRAFT);
    expect(out.status).toBe("unknown");
    expect((out as { reason: string }).reason).toMatch(/may or may not have been sent/);
  });

  it("calls a dropped connection unknown", async () => {
    expect((await harness([tokenOk(), new TypeError("fetch failed")]).sender.sendTest(DRAFT)).status).toBe("unknown");
  });

  it("calls a timeout unknown and says so", async () => {
    const hang = (init: RequestInit) => new Promise<Response>((_, reject) => (init.signal as AbortSignal).addEventListener("abort", () => reject((init.signal as AbortSignal).reason)));
    const out = await harness([tokenOk(), hang], { timeoutMs: 20 }).sender.sendTest(DRAFT);
    expect(out).toMatchObject({ status: "unknown" });
    expect((out as { reason: string }).reason).toMatch(/did not answer in time/);
  });

  it("calls a 200 with no message id unknown rather than sent", async () => {
    expect((await harness([tokenOk(), new Response("{}", { status: 200 })]).sender.sendTest(DRAFT)).status).toBe("unknown");
  });

  it("never retries an unknown send by itself: exactly one attempt reached Gmail", async () => {
    const h = harness([tokenOk(), err(503), sentOk("would-be-a-duplicate")]);
    await h.sender.sendTest(DRAFT);
    expect(h.sends()).toHaveLength(1);
  });

  it("does not retry after a timeout on the second try of a stale-token retry", async () => {
    const h = harness([tokenOk("old"), err(401), tokenOk("new"), new TypeError("fetch failed"), sentOk()]);
    expect((await h.sender.sendTest(DRAFT)).status).toBe("unknown");
    expect(h.sends()).toHaveLength(2);
  });
});

describe("sendTest: secrets stay out of results", () => {
  it("returns no token, secret or message content in any outcome", async () => {
    const outcomes = [
      await harness([err(400, { error: "invalid_grant", error_description: `bad ${SECRETS.refreshToken}` })]).sender.sendTest(DRAFT),
      await harness([tokenOk("access-SECRET"), err(500, { error: { message: "access-SECRET leaked" } })]).sender.sendTest(DRAFT),
      await harness([tokenOk("access-SECRET"), err(400, { error: { message: `Hello. ${DRAFT.body}` } })]).sender.sendTest(DRAFT),
    ];
    for (const o of outcomes) {
      const text = JSON.stringify(o);
      for (const secret of [...Object.values(SECRETS), "access-SECRET", "Hello."]) expect(text).not.toContain(secret);
    }
  });
});
