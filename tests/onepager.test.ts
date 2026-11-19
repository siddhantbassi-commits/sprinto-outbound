import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildBrief, type BriefInput } from "@/lib/brief/build";
import { clip, onePagerFilename, pdfSafe, renderOnePager, wrapText } from "@/lib/brief/onepager";

const HOME = "Page title: Acme | Workflow software\nAcme is a workflow platform for engineering teams that ship fast.\nWe announced our Series B in September. We serve customers across the EU.";
const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  domain: "acme.io",
  pages: [{ url: "https://acme.io/", kind: "home", title: "Acme | Workflow software", text: HOME }, { url: "https://acme.io/security", kind: "security", title: "Security", text: "We are working toward our SOC 2 Type II report this year." }],
  lane: "review", verdict: "qualified", score: 88, scoreReason: "Strong.",
  parts: [
    { id: "a", group: "need", label: "Certification in progress", points: 25, max: 25, quotes: ["We are working toward our SOC 2 Type II report this year."] },
    { id: "b", group: "timing", label: "Recent funding or launch", points: 8, max: 8, quotes: ["We announced our Series B in September."] },
  ],
  missing: ["securityHiring"],
  facts: { compliance: { value: "in_progress", confidence: "high", quotes: ["We are working toward our SOC 2 Type II report this year."] }, sellsEu: { value: true, confidence: "high", quotes: ["We serve customers across the EU."] }, healthData: { value: true, confidence: "high", quotes: ["patient records"] } },
  contact: { name: "Ana Rao", title: "CTO", email: "ana@acme.io", verification: "valid", confidence: 94, source: "hunter", rankScore: 80 },
  candidates: 3,
  picks: [
    { id: "P2", label: "Audit preparation eats engineering time", plain: "x", reason: "r", evidence: [{ id: "certInProgress", text: "A certification is in progress", quotes: ["We are working toward our SOC 2 Type II report this year."], kind: "page" }] },
    { id: "P5", label: "Evidence is collected by screenshots", plain: "y", reason: "r", evidence: [{ id: "certInProgress", text: "A certification is in progress", quotes: ["We are working toward our SOC 2 Type II report this year."], kind: "page" }] },
  ],
  email: { subject: "S", body: "B", status: "drafted", hookQuote: "We announced our Series B in September.", hookSource: "https://acme.io/" },
  claims: ["Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies."],
  unverifiedClaims: 0,
  ...over,
});

const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe("making text safe for the PDF fonts", () => {
  it("turns common typography into plain characters", () => {
    expect(pdfSafe("“Hello” — it’s … fine now")).toBe('"Hello" - it\'s ... fine now');
  });

  it("drops what the standard fonts cannot draw, and keeps accented Western letters", () => {
    expect(pdfSafe("Café Über 名前 \u{1F680} rocket")).toBe("Café Über rocket");
    expect(pdfSafe("a\u0000b\tc\nd")).toBe("ab c d");
  });

  it("collapses whitespace and handles nothing", () => {
    expect(pdfSafe("  a   b \n\n c ")).toBe("a b c");
    expect(pdfSafe("")).toBe("");
  });
});

describe("cutting long text", () => {
  it("leaves short text alone and cuts long text at a word with an ellipsis", () => {
    expect(clip("short one", 40)).toBe("short one");
    const c = clip("one two three four five six seven eight nine ten", 24);
    expect(c.length).toBeLessThanOrEqual(24 + 3);
    expect(c.endsWith("...")).toBe(true);
    expect(c).not.toMatch(/\s\.\.\.$/);
  });

  it("never cuts to nothing", () => {
    expect(clip("a".repeat(200), 20).length).toBeGreaterThan(5);
  });
});

describe("wrapping text to a width", () => {
  const measure = (s: string) => s.length * 5;

  it("keeps every line within the width and loses no words", () => {
    const text = "the quick brown fox jumps over the lazy dog and keeps running far away";
    const lines = wrapText(text, 100, measure);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(100);
    expect(lines.join(" ")).toBe(text);
  });

  it("splits a word wider than a line instead of overflowing", () => {
    const lines = wrapText("x".repeat(70), 100, measure);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(100);
    expect(lines.join("")).toBe("x".repeat(70));
  });

  it("handles empty text", () => {
    expect(wrapText("", 100, measure)).toEqual([]);
  });
});

describe("the download filename", () => {
  it("is the domain in plain characters", () => {
    expect(onePagerFilename("Acme.IO")).toBe("acme.io-call-one-pager.pdf");
    expect(onePagerFilename('ev"il/..\\x.com')).toBe("ev-il-..-x.com-call-one-pager.pdf");
    expect(onePagerFilename("")).toBe("company-call-one-pager.pdf");
  });
});

describe("the one-page PDF", () => {
  it("is a real PDF of exactly one A4 page, with the sections that matter", async () => {
    const { bytes, plan } = await renderOnePager(buildBrief(input()), new Date("2026-11-19T10:00:00Z"));
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2500);
    expect(await pages(bytes)).toBe(1);
    const doc = await PDFDocument.load(bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
    expect(doc.getTitle()).toBe("Discovery call one-pager: Acme");
    expect(plan.included).toEqual(expect.arrayContaining(["header", "Where they stand", "Who to speak to", "Call plan"]));
  });

  it("is still one page, and still has its header, when everything is enormous", async () => {
    const long = "extraordinarily long words and clauses ".repeat(40);
    const brief = buildBrief(input({
      pages: [{ url: "https://acme.io/", kind: "home", title: "名前 ".repeat(30) + "\u{1F680} Ünicöde Corp", text: HOME }],
      contact: { name: "N".repeat(120), title: long, email: "ana@acme.io", verification: "accept_all", confidence: 10, source: "hunter", rankScore: 1 },
      email: { subject: long, body: long, status: "drafted", hookQuote: long, hookSource: null },
      picks: [1, 2].map((n) => ({ id: `P${n}`, label: long, plain: long, reason: long, evidence: [{ id: "e", text: long, quotes: [long], kind: "page" }] })),
      others: Array.from({ length: 8 }, (_, k) => ({ name: `Person ${k} ${long}`, title: long, email: null, rankScore: 10, source: "hunter", verification: null })),
      claims: [long, long, long],
    }));
    const { bytes, plan } = await renderOnePager(brief);
    expect(await pages(bytes)).toBe(1);
    expect(plan.included[0]).toBe("header");
  });

  it("copes with a company that has almost nothing: no contact, no pains, no email, no score", async () => {
    const brief = buildBrief(input({ verdict: "needs_more", score: null, scoreReason: null, parts: [], missing: ["headcount", "compliance"], facts: null, contact: null, candidates: 0, picks: [], email: null, claims: [] }));
    const { bytes, plan } = await renderOnePager(brief);
    expect(await pages(bytes)).toBe(1);
    expect(plan.included).toContain("Where they stand");
    expect(plan.included).not.toContain("Who to speak to");
  });

  it("drops the least useful sections first when the page fills up, and still makes one page", async () => {
    const long = "word ".repeat(400);
    const brief = buildBrief(input());
    brief.intel.stance.angle = long;
    brief.intel.stance.caution = long;
    const { bytes, plan } = await renderOnePager(brief);
    expect(await pages(bytes)).toBe(1);
    expect(plan.omitted.length).toBeGreaterThan(0);
    expect(plan.included).toEqual(expect.arrayContaining(["header", "Where they stand"]));
    // The last section in the order of usefulness goes first.
    expect(plan.omitted).toContain("What to bring");
  });

  it("leaves a section out, rather than spilling onto a second page, when it alone is too big for the page", async () => {
    const huge = "word ".repeat(3000);
    const brief = buildBrief(input());
    brief.intel.stance.angle = huge;
    const { bytes, plan } = await renderOnePager(brief);
    expect(await pages(bytes)).toBe(1);
    expect(plan.omitted).toContain("Where they stand");
    expect(plan.included).toEqual(expect.arrayContaining(["header", "Who to speak to", "Call plan"]));
  });

  it("warns, in the document, about a framework no verified claim covers", async () => {
    const withHealth = buildBrief(input());
    expect(withHealth.intel.frameworks.find((f) => f.id === "hipaa")?.sprintoClaim).toBe(false);
    expect((await renderOnePager(withHealth)).plan.included).toContain("Where they stand");
  });
});
