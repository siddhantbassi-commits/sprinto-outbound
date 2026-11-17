import { describe, expect, it } from "vitest";
import { lintEmail, type LintInput } from "@/lib/email/lint";

const ADDRESS = "Sprinto, 100 Example Street, Bengaluru 560001";
const QUOTE = "Acme launched an Enterprise plan with SSO and audit logs";

const GOOD_BODY = `Hi Priya,

I saw Acme launched an Enterprise plan with SSO this quarter, which usually means security questionnaires start landing from larger buyers.

For a team your size that often turns into audit preparation eating engineering time, while the next deal waits on a report. Sprinto automates evidence collection for SOC 2 and ISO 27001.

Worth 15 minutes next week to see how teams in your spot get audit-ready?

Asha
Growth, Sprinto

If this isn't relevant, reply "no" and I won't write again. ${ADDRESS}`;

const base = (): LintInput => ({
  subject: "Enterprise plan and SOC 2",
  body: GOOD_BODY,
  firstName: "Priya",
  company: "Acme",
  hookQuote: QUOTE,
  evidenceQuotes: [QUOTE],
  allowedNumbers: ["15", "2", "27001"],
  postalAddress: ADDRESS,
});

const failing = (input: LintInput) => lintEmail(input).checks.filter((c) => !c.pass).map((c) => c.id);

describe("lintEmail", () => {
  it("passes a good draft on all 12 checks", () => {
    const r = lintEmail(base());
    expect(r.checks).toHaveLength(12);
    expect(failing(base())).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("L1 length and subject", () => {
    expect(failing({ ...base(), body: "Hi Priya,\n\nToo short. Acme? reply no " + ADDRESS })).toContain("L1");
    expect(failing({ ...base(), subject: "SOC 2 AUDIT HELP NOW" })).toContain("L1");
    expect(failing({ ...base(), subject: "Re: our chat" })).toContain("L1");
    expect(failing({ ...base(), subject: "x".repeat(61) })).toContain("L1");
    expect(failing({ ...base(), subject: "" })).toContain("L1");
  });

  it("L2 greeting must be the first name exactly", () => {
    expect(failing({ ...base(), body: GOOD_BODY.replace("Hi Priya,", "Hello there,") })).toContain("L2");
    expect(failing({ ...base(), firstName: "Priyanka" })).toContain("L2");
  });

  it("L3 names the company", () => {
    expect(failing({ ...base(), company: "Globex" })).toContain("L3");
  });

  it("L4 the hook must rest on a verified quote and be reused", () => {
    expect(failing({ ...base(), hookQuote: null })).toContain("L4");
    expect(failing({ ...base(), hookQuote: "Completely unrelated sentence about rivers and mountains" })).toContain("L4");
  });

  it("L5 exactly one ask", () => {
    expect(failing({ ...base(), body: GOOD_BODY.replace("next week to", "next week? Or to") })).toContain("L5");
    expect(failing({ ...base(), body: GOOD_BODY.replace("audit-ready?", "audit-ready.") })).toContain("L5");
  });

  it("L6 no links, emoji or exclamation marks", () => {
    expect(failing({ ...base(), body: GOOD_BODY + " https://sprinto.com" })).toContain("L6");
    expect(failing({ ...base(), body: GOOD_BODY.replace("Asha", "Asha 🚀") })).toContain("L6");
    expect(failing({ ...base(), body: GOOD_BODY.replace("audit-ready?", "audit-ready!?") })).toContain("L6");
  });

  it("L7 numbers must be sourced", () => {
    expect(failing({ ...base(), body: GOOD_BODY.replace("SOC 2 and ISO", "SOC 2 and 40% of ISO") })).toContain("L7");
    expect(failing({ ...base(), allowedNumbers: [] })).toContain("L7");
  });

  it("L7 allows numbers that come from the hook quote itself", () => {
    const q = "Acme now serves 300 enterprise customers worldwide";
    const body = GOOD_BODY.replace("this quarter", "with 300 enterprise customers worldwide");
    expect(failing({ ...base(), hookQuote: q, evidenceQuotes: [q], body })).not.toContain("L7");
  });

  it("L8 no claim about a source we did not use", () => {
    expect(failing({ ...base(), body: GOOD_BODY.replace("I saw", "I saw your LinkedIn post and") })).toContain("L8");
    const q = "Our podcast launched in March";
    expect(failing({ ...base(), body: GOOD_BODY.replace("I saw", "I heard your podcast and"), evidenceQuotes: [QUOTE, q] })).not.toContain("L8");
  });

  it("L9 banned phrases", () => {
    expect(failing({ ...base(), body: GOOD_BODY.replace("I saw", "Hope this email finds you well. I saw") })).toContain("L9");
    expect(failing({ ...base(), subject: "A game-changer for audits" })).toContain("L9");
  });

  it("L10 opt-out line and postal address", () => {
    expect(failing({ ...base(), body: GOOD_BODY.replace('reply "no" and I won\'t write again.', "") })).toContain("L10");
    expect(failing({ ...base(), body: GOOD_BODY.replace(ADDRESS, "") })).toContain("L10");
    expect(failing({ ...base(), postalAddress: "" })).toContain("L10");
  });

  it("L11 control characters in the subject or names (header injection)", () => {
    expect(failing({ ...base(), subject: "Hello\r\nBcc: someone@evil.com" })).toContain("L11");
    expect(failing({ ...base(), firstName: "Priya\n" })).toContain("L11");
  });

  it("L12 model scaffolding", () => {
    expect(failing({ ...base(), body: GOOD_BODY.replace("Asha", "[Your Name]") })).toContain("L12");
    expect(failing({ ...base(), body: "```\n" + GOOD_BODY + "\n```" })).toContain("L12");
    expect(failing({ ...base(), body: GOOD_BODY.replace("I saw", "As an AI, I saw") })).toContain("L12");
  });

  it("gives a plain message for each failure", () => {
    const bad = lintEmail({ ...base(), company: "Globex" }).checks.find((c) => c.id === "L3");
    expect(bad).toEqual({ id: "L3", pass: false, message: "The body must mention Globex" });
  });
});
