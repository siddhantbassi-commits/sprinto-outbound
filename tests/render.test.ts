import { describe, expect, it } from "vitest";
import type { HeaderInput } from "@/lib/email/inbox-header";
import { buildMessage, readMessage } from "@/lib/email/mime";
import { parseLetter, renderEmailHtml } from "@/lib/email/render";

const BODY = [
  "Dear Priya,",
  "",
  "I noticed that Acme is working toward SOC 2 this year.\nTeams at that stage often lose weeks to questionnaires.",
  "",
  "Would a 15-minute call next week be useful?",
  "",
  "Kind regards,",
  "Asha",
  "Growth Lead, Sprinto",
  "",
  'If this is not relevant, please reply "no" and I will not write again. 1 Example Street, Pune 411001',
].join("\n");

const NOTICE: HeaderInput & { briefUrl: string | null } = {
  contactName: "Priya Rao", contactTitle: "CTO", contactEmail: "priya@acme.com", company: "Acme", domain: "acme.com",
  emailVerification: "valid", emailConfidence: 94, verdict: "qualified", score: 78,
  reasons: [{ label: "Certification in progress", quote: "We are working toward SOC 2" }],
  chosenScore: 88, runnerUp: null, pains: [{ id: "P2", label: "Audit preparation eats engineering time" }],
  hookSource: "https://acme.com/security", traceUrl: "https://app.example.com/prospects/1", briefUrl: "https://app.example.com/prospects/1/brief",
};

describe("parseLetter", () => {
  it("finds the greeting, the paragraphs, the sign-off and the opt-out line", () => {
    const l = parseLetter(BODY);
    expect(l.greeting).toBe("Dear Priya,");
    expect(l.paragraphs).toEqual([["I noticed that Acme is working toward SOC 2 this year.", "Teams at that stage often lose weeks to questionnaires."], ["Would a 15-minute call next week be useful?"]]);
    expect(l.signoff).toEqual({ closing: "Kind regards,", lines: ["Asha", "Growth Lead, Sprinto"] });
    expect(l.footer).toMatch(/^If this is not relevant, please reply "no"/);
  });

  it("keeps a body it does not recognise as plain paragraphs rather than dropping any of it", () => {
    const l = parseLetter("Just a note.\n\nAnd another.");
    expect(l.greeting).toBeNull();
    expect(l.signoff).toBeNull();
    expect(l.footer).toBeNull();
    expect(l.paragraphs).toEqual([["Just a note."], ["And another."]]);
  });

  it("copes with Windows line endings and extra blank lines", () => {
    expect(parseLetter("Dear A,\r\n\r\n\r\nText.\r\n\r\nKind regards,\r\nB\r\n").signoff?.lines).toEqual(["B"]);
  });
});

describe("renderEmailHtml", () => {
  const html = renderEmailHtml({ subject: "SOC 2 readiness at Acme", body: BODY });

  it("lays the email out as a letter with every word of the approved text", () => {
    for (const w of ["Dear Priya,", "I noticed that Acme is working toward SOC 2 this year.", "Would a 15-minute call next week be useful?", "Kind regards,", "Asha", "Growth Lead, Sprinto", "1 Example Street, Pune 411001"]) expect(html).toContain(w);
    expect(html).toContain("<title>SOC 2 readiness at Acme</title>");
    expect(html).toContain("SPRINTO");
  });

  it("has no notice unless one is given, so it can never be mistaken for a real recipient's copy", () => {
    expect(html).not.toContain("Test delivery");
    expect(html).not.toContain("priya@acme.com");
  });

  it("adds the test notice under the letter when asked", () => {
    const t = renderEmailHtml({ subject: "S", body: BODY, notice: NOTICE });
    expect(t).toContain("Test delivery");
    expect(t).toContain("It was not sent to the contact");
    expect(t).toContain("priya@acme.com");
    expect(t).toContain('href="https://app.example.com/prospects/1/brief"');
    expect(t.indexOf("Kind regards,")).toBeLessThan(t.indexOf("Test delivery"));
  });

  it("escapes everything it is given, so scraped or edited text cannot add markup or script", () => {
    const evil = renderEmailHtml({
      subject: '</title><script>alert(1)</script>',
      body: 'Dear <img src=x onerror=alert(1)>,\n\n<script>alert(2)</script> & "quotes"\n\nKind regards,\n<b>Asha</b>',
      notice: { ...NOTICE, company: "<i>Acme</i>", contactName: '"><script>x</script>', reasons: [{ label: "<u>x</u>", quote: null }], hookSource: "javascript:alert(1)" },
    });
    expect(evil).not.toMatch(/<script|<img|<b>|<i>|<u>/);
    expect(evil).toContain("&lt;script&gt;");
  });

  it("loads nothing from outside: no images, no stylesheets, no scripts, no fonts", () => {
    const t = renderEmailHtml({ subject: "S", body: BODY, notice: NOTICE });
    expect(t).not.toMatch(/<img|<script|<link|@import|url\(|<iframe|<form/i);
    // The only link is the one the notice was given; the hook's page address is shown as text, not linked.
    expect([...t.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])).toEqual(["https://app.example.com/prospects/1/brief"]);
  });

  it("does not let the notice's link be anything but the address it was given, escaped", () => {
    const t = renderEmailHtml({ subject: "S", body: BODY, notice: { ...NOTICE, briefUrl: 'https://x.example/"><script>1</script>' } });
    expect(t).not.toContain("<script>1");
  });
});

describe("a message with an HTML alternative", () => {
  const base = { from: "me@example.com", to: "me@example.com", subject: "SOC 2 readiness at Acme", body: BODY, runId: "run_1", date: new Date("2026-11-03T10:00:00Z") };

  it("is multipart/alternative with plain text first and HTML last, and both read back exactly", () => {
    const html = renderEmailHtml({ subject: base.subject, body: BODY });
    const raw = buildMessage({ ...base, html });
    const m = readMessage(raw);
    expect(m.head).toMatch(/Content-Type: multipart\/alternative; boundary="=_[0-9a-f]+"/);
    expect(raw.indexOf("text/plain")).toBeLessThan(raw.indexOf("text/html"));
    expect(m.text.replace(/\r\n/g, "\n")).toBe(BODY);
    expect(m.html?.replace(/\r\n/g, "\n")).toBe(html);
    expect(raw.trimEnd().endsWith("--")).toBe(true);
  });

  it("is still plain text only without HTML", () => {
    const m = readMessage(buildMessage(base));
    expect(m.html).toBeNull();
    expect(m.head).toContain("Content-Type: text/plain");
  });

  it("cannot be made to carry another recipient or header through the HTML or the text", () => {
    const raw = buildMessage({ ...base, body: "x\r\nBcc: a@evil.com\r\n\r\ny", html: "<p>z</p>\r\nBcc: b@evil.com" });
    const head = raw.split("\r\n\r\n")[0]!;
    expect(head.match(/^(To|Cc|Bcc): /gim)).toEqual(["To: "]);
    expect(raw).not.toMatch(/^Bcc:/m);
  });

  it("uses a different boundary each time and never one that appears in the content", () => {
    const a = buildMessage({ ...base, html: "<p>x</p>" }).match(/boundary="([^"]+)"/)![1];
    const b = buildMessage({ ...base, html: "<p>x</p>" }).match(/boundary="([^"]+)"/)![1];
    expect(a).not.toBe(b);
  });

  it("strips control characters from the HTML as it does from the text", () => {
    const m = readMessage(buildMessage({ ...base, html: "<p>a" + String.fromCharCode(0) + "b" + String.fromCharCode(7) + "c</p>" }));
    expect(m.html).toBe("<p>abc</p>");
  });
});
