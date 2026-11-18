import { describe, expect, it } from "vitest";
import { getDemo } from "@/lib/demo/world";
import { pgPort } from "@/lib/db/pg-port";
import { briefFor } from "@/lib/app/brief";
import { isCallable, listLeads } from "@/lib/app/leads";
import { buildBrief, briefToText, type BriefInput } from "@/lib/brief/build";
import { FRAMING, OBJECTIONS, QUESTIONS } from "@/lib/brief/library";
import { PAINS } from "@/lib/pitch/pains";

const HOME = "Page title: Acme | Workflow software\nAcme is a workflow platform for engineering teams that ship fast.\nWe announced our Series B in September.";
const base = (over: Partial<BriefInput> = {}): BriefInput => ({
  domain: "acme.io",
  pages: [{ url: "https://acme.io/", kind: "home", title: "Acme | Workflow software", text: HOME }, { url: "https://acme.io/security", kind: "security", title: "Security", text: "We are working toward our SOC 2 Type II report this year." }],
  lane: "review", verdict: "qualified", score: 88, scoreReason: "Strong.",
  parts: [
    { id: "a", group: "need", label: "Certification in progress", points: 25, max: 25, quotes: ["We are working toward our SOC 2 Type II report this year."] },
    { id: "b", group: "timing", label: "Recent funding or launch", points: 8, max: 8, quotes: ["We announced our Series B in September."] },
    { id: "c", group: "fit", label: "Size", points: 10, max: 10, quotes: [] },
    { id: "d", group: "penalty", label: "Uses a competitor", points: -15, max: -15, quotes: [] },
  ],
  missing: ["securityHiring"],
  facts: { headcount: { value: "51-200", confidence: "high", quotes: [] }, compliance: { value: "in_progress", confidence: "high", quotes: [] }, product: { value: "platform", confidence: "high", quotes: [] } },
  contact: { name: "Ana Rao", title: "CTO", email: "ana@acme.io", verification: "valid", confidence: 94, source: "hunter", rankScore: 80 },
  candidates: 3,
  picks: [
    { id: "P2", label: "Audit preparation eats engineering time", plain: "x", reason: "Their team is small and an audit is in progress.", evidence: [{ id: "certInProgress", text: "A certification is in progress", quotes: ["We are working toward our SOC 2 Type II report this year."], kind: "quote" }] },
    { id: "P5", label: "Evidence is collected by screenshots and spreadsheets", plain: "y", reason: "An audit is in progress.", evidence: [{ id: "certInProgress", text: "A certification is in progress", quotes: ["We are working toward our SOC 2 Type II report this year."], kind: "quote" }] },
  ],
  email: { subject: "S", body: "B", status: "drafted", hookQuote: "We announced our Series B in September.", hookSource: "https://acme.io/" },
  claims: ["Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies."],
  unverifiedClaims: 0,
  ...over,
});

describe("the library", () => {
  it("has framing and questions for every one of the nine pains, and nothing for a pain that does not exist", () => {
    for (const p of PAINS) {
      expect(FRAMING[p.id].length).toBeGreaterThan(20);
      expect(QUESTIONS[p.id].length).toBeGreaterThanOrEqual(2);
    }
    expect(Object.keys(FRAMING).sort()).toEqual(PAINS.map((p) => p.id).sort());
  });
  it("states no claim about Sprinto (those come only from the verified facts file)", () => {
    const words = [...Object.values(FRAMING), ...Object.values(QUESTIONS).flat(), ...OBJECTIONS.map((o) => o.response)].join(" ");
    expect(words).not.toMatch(/\bSprinto\b/);
    expect(words).not.toMatch(/\d+%|\bcertified in\b|\bguarantee/i);
  });
});

describe("buildBrief", () => {
  const b = buildBrief(base());

  it("names the company from its own site and quotes how it describes itself", () => {
    expect(b.company.name).toBe("Acme");
    expect(b.company.about).toMatch(/workflow platform for engineering teams/);
    expect(b.company.size).toBe("51-200");
    expect(b.company.certification).toBe("A certification is in progress");
  });

  it("explains the fit with the strongest reasons first, each with its quote and the page it came from", () => {
    expect(b.fit.label).toBe("Strong fit");
    expect(b.fit.strengths.map((s) => s.text)).toEqual(["Certification in progress", "Size", "Recent funding or launch"]);
    expect(b.fit.strengths[0]).toMatchObject({ quote: "We are working toward our SOC 2 Type II report this year.", source: "https://acme.io/security" });
    expect(b.fit.strengths[1]!.quote).toBeNull();
    expect(b.fit.summary).toMatch(/88 out of 100/);
  });

  it("says what is not known, and what counted against it, rather than leaving it out", () => {
    expect(b.fit.gaps).toEqual(["Uses a competitor", "securityHiring was not visible on the site"]);
  });

  it("puts the timing signals under Why now", () => {
    expect(b.whyNow).toHaveLength(1);
    expect(b.whyNow[0]).toMatchObject({ text: "Recent funding or launch", source: "https://acme.io/" });
  });

  it("gives each chosen pain its framing and its evidence, and asks the questions for exactly those pains", () => {
    expect(b.talkingPoints.map((t) => t.id)).toEqual(["P2", "P5"]);
    expect(b.talkingPoints[0]!.framing).toBe(FRAMING.P2);
    expect(b.talkingPoints[0]!.evidence[0]!.source).toBe("https://acme.io/security");
    const forPains = b.questions.filter((q) => q.pain).map((q) => q.text);
    expect(forPains).toEqual([...QUESTIONS.P2, ...QUESTIONS.P5]);
    expect(b.questions.filter((q) => !q.pain).length).toBeGreaterThanOrEqual(3);
  });

  it("offers only the objections the evidence makes likely", () => {
    const says = b.objections.map((o) => o.says);
    expect(says).toContain("We already have a consultant or an auditor.");
    expect(says).not.toContain("We already have a SOC 2 report, so we are fine.");
    expect(says).toContain("It is not a priority this quarter.");
    const held = buildBrief(base({ facts: { compliance: { value: "soc2_type2", confidence: "high", quotes: [] } }, picks: [{ id: "P4", label: "L", plain: "p", reason: "r", evidence: [{ id: "reportHeld", text: "t", quotes: [], kind: "code_checked" }, { id: "oneCertHeld", text: "t", quotes: [], kind: "code_checked" }] }] }));
    expect(held.objections.map((o) => o.says)).toContain("We already have a SOC 2 report, so we are fine.");
  });

  it("lists as quotable about Sprinto only the verified claims, and trusts the contact only as far as the verification goes", () => {
    expect(b.mayState).toEqual(["Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies."]);
    expect(b.contact!.trust).toBe("Hunter verified the address (94% sure)");
    expect(buildBrief(base({ contact: { name: "A", title: "CTO", email: "a@acme.io", verification: "unknown", confidence: null, source: "hunter", rankScore: 1 } })).contact!.trust).toMatch(/could not fully verify/);
    expect(buildBrief(base({ contact: { name: "A", title: "CTO", email: "a@acme.io", verification: null, confidence: null, source: "manual", rankScore: null } })).contact!.trust).toBe("Hand-picked by a person");
  });

  it("is ready for a call only when every ingredient is there, and names the one that is missing", () => {
    expect(b.ready.ok).toBe(true);
    const r = buildBrief(base({ contact: null, claims: [] }));
    expect(r.ready.ok).toBe(false);
    expect(r.ready.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(["A named person to speak to", "Verified facts about Sprinto to cite"]);
  });

  it("does not call a company a fit that was not one, or one it could not judge", () => {
    expect(buildBrief(base({ verdict: "not_fit", score: 12, scoreReason: "Consumer product." })).fit.label).toBe("Not a fit");
    expect(buildBrief(base({ verdict: "needs_more", score: null })).fit.summary).toMatch(/not been scored/);
    expect(buildBrief(base({ verdict: null })).fit.label).toBe("Not enough to judge");
  });

  it("turns into plain text a person can paste, with the company, the fit, the person, the points and the questions", () => {
    const t = briefToText(b);
    expect(t).toMatch(/^DISCOVERY CALL BRIEF: Acme \(acme\.io\)/);
    for (const part of ["Strong fit (88/100)", "Ana Rao, CTO <ana@acme.io>", "WHY NOW", "TALKING POINTS", "QUESTIONS TO ASK", "IF THEY SAY", "WHAT YOU MAY SAY ABOUT SPRINTO", "NOT KNOWN", QUESTIONS.P2[0]!]) expect(t).toContain(part);
  });
});

describe("the brief and the Leads list, from the demo world", () => {
  it("builds a complete brief for a researched company from what the database holds", async () => {
    const w = await getDemo();
    const db = pgPort(w.db.as(w.users.operator));
    const [northwind] = await w.db.admin<{ id: string }>("select id from public.prospects where domain = 'northwind.io' order by created_at limit 1");
    const view = (await briefFor(db, northwind!.id, true))!;
    expect(view.brief.company.name).toBe("Northwind");
    expect(view.brief.fit.score).toBeGreaterThan(60);
    expect(view.brief.contact?.name).toMatch(/Ananya Rao/);
    expect(view.brief.talkingPoints).toHaveLength(2);
    expect(view.brief.talkingPoints.every((t) => t.evidence.length > 0)).toBe(true);
    expect(view.brief.mayState.length).toBeGreaterThan(0);
    expect(view.brief.email?.subject).toBeTruthy();
    expect(view.brief.ready.ok).toBe(true);
  }, 60_000);

  it("lists the other people worth speaking to, each with the pain their role feels, and never shows a viewer their name or address", async () => {
    const w = await getDemo();
    const [row] = await w.db.admin<{ id: string }>("select id from public.prospects where domain = 'northwind.io' order by created_at limit 1");
    const op = (await briefFor(pgPort(w.db.as(w.users.operator)), row!.id, true))!.brief;
    expect(op.group.map((m) => m.name)).toEqual(["Dev Patel"]);
    expect(op.group[0]).toMatchObject({ title: "VP Engineering", role: "eng_head", email: "dev@northwind.io" });
    expect(op.group[0]!.angle).not.toBeNull();
    const viewer = (await briefFor(pgPort(w.db.as(w.users.viewer)), row!.id, false))!.brief;
    expect(viewer.group[0]!.name).toMatch(/^[A-Z]\.$/);
    expect(viewer.group[0]!.email).toBeNull();
    expect(JSON.stringify(viewer.group)).not.toMatch(/Dev Patel|dev@northwind/);
  }, 60_000);

  it("shows a viewer no address and only an initial", async () => {
    const w = await getDemo();
    const db = pgPort(w.db.as(w.users.viewer));
    const [row] = await w.db.admin<{ id: string }>("select id from public.prospects where domain = 'northwind.io' order by created_at limit 1");
    const view = (await briefFor(db, row!.id, false))!;
    expect(view.brief.contact?.email).toBeNull();
    expect(view.brief.contact?.name).toMatch(/^[A-Z]\.$/);
  }, 60_000);

  it("lists leads best fit first, marks who is worth a call, and leaves out nobody who was researched", async () => {
    const w = await getDemo();
    const leads = await listLeads(pgPort(w.db.as(w.users.operator)), true);
    const callable = leads.filter(isCallable);
    expect(callable.length).toBeGreaterThanOrEqual(2);
    expect(callable.every((l) => l.verdict === "qualified" || l.verdict === "maybe")).toBe(true);
    const nw = leads.find((l) => l.domain === "northwind.io")!;
    expect(nw.contact?.name).toMatch(/Ananya/);
    expect(nw.pains).toHaveLength(2);
    expect(leads.find((l) => l.domain === "petalpop.app")!.verdict).toBe("not_fit");
    expect(leads.map((l) => l.domain)).toEqual(expect.arrayContaining(["northwind.io", "lumenhealth.com", "vanta.com", "quietcloud.dev"]));
    expect(new Set(leads.map((l) => l.domain)).size).toBe(leads.length);
    expect(nw.name).toBe("Northwind");
  }, 60_000);

  it("shows a viewer a contact's initial in the Leads list, never the name", async () => {
    const w = await getDemo();
    const leads = await listLeads(pgPort(w.db.as(w.users.viewer)), false);
    const nw = leads.find((l) => l.domain === "northwind.io")!;
    expect(nw.contact?.name).toMatch(/^[A-Z]\.$/);
    expect(JSON.stringify(leads)).not.toMatch(/Ananya|ananya@/i);
  }, 60_000);

  it("shows a company researched twice once, with the research that was done, not a later skipped row", async () => {
    const w = await getDemo();
    await w.db.as(w.users.operator).query("select public.create_run($1::text[], 'discover', 'Again', '{}'::jsonb)", [["northwind.io"]]);
    const leads = await listLeads(pgPort(w.db.as(w.users.operator)), true);
    expect(leads.filter((l) => l.domain === "northwind.io")).toHaveLength(1);
    // The new run skipped it (it was just mailed); the research already done still stands.
    expect(leads.find((l) => l.domain === "northwind.io")!.verdict).toBe("qualified");
  }, 60_000);
});
