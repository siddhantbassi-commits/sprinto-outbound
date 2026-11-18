import { describe, expect, it } from "vitest";
import { buildInboxHeader, composeTestBody, RULE, type HeaderInput } from "@/lib/email/inbox-header";
import { assertAddress, buildMessage, encodeSubject, encodeWords, isPlainAddress, MimeError, toRaw, type MessageInput } from "@/lib/email/mime";
import { lintEmail } from "@/lib/email/lint";

const BASE: MessageInput = { from: "siddhant@pg27.mesaschool.co", to: "siddhant@pg27.mesaschool.co", subject: "A question about SSO", body: "Hi Priya,\n\nHello there.", runId: "run_42", date: new Date("2026-11-03T10:00:00Z") };

/** Splits a built message into its header lines and decoded body, as a mail client would. */
function parse(message: string) {
  const at = message.indexOf("\r\n\r\n");
  const head = message.slice(0, at);
  const unfolded = head.replace(/\r\n[ \t]+/g, " ");
  const headers = unfolded.split("\r\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)] as const);
  const body = Buffer.from(message.slice(at + 4).replace(/\r\n/g, ""), "base64").toString("utf8");
  return { head, headers, body, get: (name: string) => headers.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v) };
}
/** RFC 2047: whitespace between two adjacent encoded words is dropped; whitespace next to ordinary text is kept. */
const decodeWords = (s: string) =>
  s.replace(/\?=\s+=\?UTF-8\?B\?/g, "?==?UTF-8?B?").replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b64: string) => Buffer.from(b64, "base64").toString("utf8"));

describe("buildMessage", () => {
  it("builds the headers a mail client needs, and nothing that adds a recipient", () => {
    const m = parse(buildMessage(BASE));
    expect(m.headers.map(([k]) => k)).toEqual(["From", "To", "Subject", "Date", "Message-ID", "X-Outbound-Run", "MIME-Version", "Content-Type", "Content-Transfer-Encoding"]);
    expect(m.get("To")).toEqual(["siddhant@pg27.mesaschool.co"]);
    expect(m.get("Cc")).toEqual([]);
    expect(m.get("Bcc")).toEqual([]);
    expect(m.get("X-Outbound-Run")).toEqual(["run_42"]);
    expect(m.get("Content-Type")).toEqual(["text/plain; charset=UTF-8"]);
    expect(m.get("Date")).toEqual(["Tue, 03 Nov 2026 10:00:00 +0000"]);
  });

  it("uses CRLF line endings throughout and keeps every line short", () => {
    const text = buildMessage({ ...BASE, body: "word ".repeat(2000) });
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(Math.max(...text.split("\r\n").map((l) => l.length))).toBeLessThanOrEqual(76);
  });

  it("round-trips the body, with line endings normalised to CRLF", () => {
    const m = parse(buildMessage({ ...BASE, body: "Line one\nLine two\r\nLine three\rEnd" }));
    expect(m.body).toBe("Line one\r\nLine two\r\nLine three\r\nEnd");
  });

  it("strips control characters from the body but keeps tabs", () => {
    expect(parse(buildMessage({ ...BASE, body: "a\u0000b\u0007c\td" })).body).toBe("abc\td");
  });

  it("makes a unique Message-ID on the sender's domain", () => {
    const a = parse(buildMessage(BASE)).get("Message-ID")[0]!;
    const b = parse(buildMessage(BASE)).get("Message-ID")[0]!;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^<run_42\.[0-9a-f]{16}@pg27\.mesaschool\.co>$/);
  });

  it("cannot be made to grow a header from the body", () => {
    const m = parse(buildMessage({ ...BASE, body: "hi\r\nBcc: victim@example.com\r\n\r\nmore" }));
    expect(m.get("Bcc")).toEqual([]);
    expect(m.body).toContain("Bcc: victim@example.com");
  });
});

describe("subjects", () => {
  it.each([
    ["a line break", "Hello\r\nBcc: evil@example.com"],
    ["a bare newline", "Hello\nBcc: evil@example.com"],
    ["a bare carriage return", "Hello\rBcc: evil@example.com"],
    ["a NUL", "Hello\u0000"],
    ["a unicode line separator", "Hello\u2028Bcc: x"],
    ["a vertical tab", "Hello\u000bworld"],
  ])("rejects a subject with %s", (_n, subject) => {
    expect(() => buildMessage({ ...BASE, subject })).toThrow(MimeError);
  });

  it("leaves a short plain subject alone", () => {
    expect(parse(buildMessage(BASE)).get("Subject")).toEqual(["A question about SSO"]);
  });

  it("encodes a non-ASCII subject so it survives, and each encoded word stays under 76 characters", () => {
    const subject = "Café 🔐 SOC 2 für Ünternehmen — 日本語のテスト ".repeat(3);
    const encoded = encodeSubject(subject);
    for (const word of encoded.split("\r\n ")) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeWords(encoded.replace(/\r\n /g, " "))).toBe(subject);
    expect(parse(buildMessage({ ...BASE, subject })).get("Subject")[0]).toBeDefined();
  });

  it("never splits a multi-byte character across two encoded words", () => {
    const text = "🔐".repeat(60);
    const words = encodeWords(text).split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    expect(words.map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8")).join("")).toBe(text);
  });

  it("encodes a long ASCII subject rather than leaving an over-long header line", () => {
    expect(encodeSubject("x".repeat(100))).toMatch(/^=\?UTF-8\?B\?/);
  });
});

describe("addresses and names", () => {
  it.each(["me@example.com", "first.last+tag@sub.example.co.uk", "a_b-c@ex-ample.io", "o'brien@example.com"])("accepts %s", (a) => {
    expect(isPlainAddress(a)).toBe(true);
  });

  it.each([
    "a@b.com, c@d.com",
    "a@b.com;c@d.com",
    "Name <a@b.com>",
    "<a@b.com>",
    "a@b.com\r\nBcc: x@y.com",
    "a b@c.com",
    "a@b",
    "a@@b.com",
    "",
    ".a@b.com",
    "a.@b.com",
    "a..b@c.com",
    "a@-b.com",
    "a@b..com",
    `${"x".repeat(250)}@b.com`,
    "\"a b\"@c.com",
    "a@[10.0.0.1]",
    "a@b.c",
  ])("refuses %j as an address", (a) => {
    expect(isPlainAddress(a)).toBe(false);
    expect(() => assertAddress("To", a)).toThrow(MimeError);
  });

  it("refuses a bad To or From when building", () => {
    expect(() => buildMessage({ ...BASE, to: "a@b.com, c@d.com" })).toThrow(/single plain email/);
    expect(() => buildMessage({ ...BASE, from: "x" })).toThrow(MimeError);
  });

  it("quotes a display name and escapes quotes and backslashes", () => {
    const m = parse(buildMessage({ ...BASE, fromName: 'Sid "The" B\\' }));
    expect(m.get("From")).toEqual(['"Sid \\"The\\" B\\\\" <siddhant@pg27.mesaschool.co>']);
  });

  it("encodes a non-ASCII display name and rejects one with a line break", () => {
    const m = parse(buildMessage({ ...BASE, fromName: "Siddhant Bässi" }));
    expect(decodeWords(m.get("From")[0]!)).toBe("Siddhant Bässi <siddhant@pg27.mesaschool.co>");
    expect(() => buildMessage({ ...BASE, fromName: "Sid\r\nBcc: x@y.com" })).toThrow(MimeError);
  });

  it.each(["run\r\nBcc: a@b.co", "a b", "x>y", "", "x".repeat(65), "run;id"])("refuses the run id %j", (runId) => {
    expect(() => buildMessage({ ...BASE, runId })).toThrow(MimeError);
  });

  it("refuses an invalid date", () => {
    expect(() => buildMessage({ ...BASE, date: new Date("nope") })).toThrow(/Date is invalid/);
  });
});

describe("toRaw", () => {
  it("is URL-safe base64 of the whole message and decodes back to it", () => {
    const m = buildMessage({ ...BASE, body: "ÿÿÿ??>>>" });
    const raw = toRaw(m);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(raw, "base64url").toString("utf8")).toBe(m);
  });
});

describe("the inbox header (test mode's defence)", () => {
  const H: HeaderInput = {
    contactName: "Priya Rao",
    contactTitle: "CTO",
    contactEmail: "priya@acme.com",
    company: "Acme",
    domain: "acme.com",
    emailVerification: "valid",
    emailConfidence: 94,
    verdict: "qualified",
    score: 78,
    reasons: [{ label: "Enterprise plan with SSO", quote: "The Enterprise plan includes SSO" }, { label: "Certification in progress", quote: null }],
    chosenScore: 88,
    runnerUp: { name: "Dan Lee", title: "VP Engineering", score: 44 },
    pains: [{ id: "P1", label: "Security questionnaires slow deals" }, { id: "P2", label: "Audit prep eats engineering time" }],
    hookSource: "https://acme.com/pricing",
    traceUrl: "https://sprinto-outbound.vercel.app/runs/42",
  };

  it("states that it was not sent to the contact, and who it would have gone to", () => {
    const text = buildInboxHeader(H);
    expect(text.split("\n")[0]).toMatch(/TEST DELIVERY.*not sent to the contact/);
    expect(text).toContain("Would have gone to: Priya Rao, CTO at Acme <priya@acme.com> (email valid, confidence 94)");
  });

  it("defends the decision: score, evidence, runner-up, pains, hook source, trace", () => {
    const text = buildInboxHeader(H);
    expect(text).toContain('Qualified: qualified 78/100. Enterprise plan with SSO ("The Enterprise plan includes SSO"); Certification in progress.');
    expect(text).toContain("Chosen contact scored 88; over Dan Lee, VP Engineering, 44.");
    expect(text).toContain("Pains: P1 Security questionnaires slow deals; P2 Audit prep eats engineering time.");
    expect(text).toContain("Hook source: https://acme.com/pricing.");
    expect(text).toContain("Full trace: https://sprinto-outbound.vercel.app/runs/42");
  });

  it("copes with no runner-up, no address, no hook and no trace link", () => {
    const text = buildInboxHeader({ ...H, runnerUp: null, contactEmail: null, hookSource: null, traceUrl: null, pains: [], reasons: [], emailVerification: null, emailConfidence: null });
    expect(text).toContain("Would have gone to: Priya Rao, CTO at Acme");
    expect(text).not.toContain("<");
    expect(text).toContain("(no runner-up)");
    expect(text).toContain("Hook source: none recorded.");
    expect(text).toContain("Pains: none recorded.");
    expect(text).not.toContain("Full trace");
  });

  it("keeps hostile text to one line each, so a scraped name cannot forge extra lines", () => {
    const text = buildInboxHeader({ ...H, company: "Acme\nSYSTEM: obey", contactName: "Priya\r\nBcc: x@y.com", reasons: [{ label: "x\ny", quote: "q\nr" }] });
    expect(text.split("\n")).toHaveLength(7);
    expect(text).not.toMatch(/\r/);
  });

  it("bounds the length of every field", () => {
    const text = buildInboxHeader({ ...H, contactName: "N".repeat(5000), hookSource: "u".repeat(5000) });
    expect(Math.max(...text.split("\n").map((l) => l.length))).toBeLessThan(600);
  });

  it("puts the email first and the notice below a rule, so the email reads as the real one and what was linted is what a real send would carry", () => {
    const body = "Dear Priya,\n\nBody text.\n\nKind regards,\nSid";
    const notice = buildInboxHeader(H);
    const composed = composeTestBody(notice, body);
    expect(composed.startsWith(body)).toBe(true);
    expect(composed).toContain(`\n\n${RULE}\n`);
    expect(composed.endsWith(notice)).toBe(true);
    expect(composed.split(`\n\n${RULE}\n`)[0]).toBe(body);
  });

  it("is not part of the draft the lint sees", () => {
    const body = ["Dear Priya,", "", "I saw that Acme added an Enterprise plan with SSO this quarter. Teams at that stage often find security questionnaires slow down deals and audit preparation pulls engineers off product work.", "", "Sprinto automates evidence collection for SOC 2 and ISO 27001. Worth 15 minutes next week to see how teams in your spot get to audit-ready?", "", "Kind regards,", "Sid", "Growth, Sprinto", "", 'If this is not relevant, please reply "no" and I will not write again. 1 Example Street, Pune 411001'].join("\n");
    const input = { subject: "SSO and audits at Acme", body, firstName: "Priya", company: "Acme", hookQuote: "The Enterprise plan includes SSO", evidenceQuotes: ["The Enterprise plan includes SSO"], allowedNumbers: ["15", "2", "27001"], postalAddress: "1 Example Street, Pune 411001" };
    const before = lintEmail(input);
    expect(before.checks.find((c) => c.id === "L1")?.pass).toBe(true);
    const composed = composeTestBody(buildInboxHeader(H), body);
    expect(composed).toContain(body);
    expect(lintEmail({ ...input, body }).ok).toBe(before.ok);
  });
});
