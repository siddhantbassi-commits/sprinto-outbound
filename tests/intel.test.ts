import { describe, expect, it } from "vitest";
import { buildIntel, type IntelInput } from "@/lib/brief/intel";
import { ICP_V1 } from "@/lib/icp/config";

const f = (value: unknown, quote?: string) => ({ value, confidence: "high", quotes: quote ? [quote] : [] });
const PAGES = [{ url: "https://x.com/security", text: "We hold SOC 2 Type 2. Enterprise customers get SSO. We sell across Europe." }];
const BASE: IntelInput = {
  facts: null, pages: PAGES, verdict: "maybe", score: 50, icp: { qualifyAt: ICP_V1.qualifyAt, maybeAt: ICP_V1.maybeAt, points: ICP_V1.points },
  missing: [], picks: [], whyNow: [], hook: null, claims: ["Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies."], group: [], contact: null, usesCompetitor: null, pagesRead: 5,
};
const withFacts = (facts: Record<string, ReturnType<typeof f>>, over: Partial<IntelInput> = {}) => buildIntel({ ...BASE, facts, ...over });
const fw = (i: ReturnType<typeof buildIntel>, id: string) => i.frameworks.find((x) => x.id === id)!;

describe("where they stand on each framework", () => {
  it("reads a held certification straight off the page, with its quote and source", () => {
    const i = withFacts({ compliance: f("soc2_type2", "We hold SOC 2 Type 2.") });
    expect(fw(i, "soc2")).toMatchObject({ status: "held", basis: "stated", headline: "SOC 2 Type 2 held", quote: "We hold SOC 2 Type 2.", source: "https://x.com/security" });
    expect(fw(i, "iso27001").status).toBe("not_indicated");
  });

  it("tells Type 1 from Type 2 and says why Type 2 is the next step", () => {
    const r = fw(withFacts({ compliance: f("soc2_type1", "SOC 2 Type 1") }), "soc2");
    expect(r.headline).toBe("SOC 2 Type 1 held");
    expect(r.because).toMatch(/Type 2 shows they work over months/);
  });

  it("holds both frameworks when both are stated", () => {
    const i = withFacts({ compliance: f("soc2_iso", "SOC 2 Type 2 and ISO 27001") });
    expect([fw(i, "soc2").status, fw(i, "iso27001").status]).toEqual(["held", "held"]);
  });

  it("puts a framework in progress only when the page says which, or leaves SOC 2 as the likely one", () => {
    expect(fw(withFacts({ compliance: f("in_progress", "We are working towards ISO 27001") }), "iso27001").status).toBe("in_progress");
    expect(fw(withFacts({ compliance: f("in_progress", "We are working towards ISO 27001") }), "soc2").status).not.toBe("in_progress");
    expect(fw(withFacts({ compliance: f("in_progress", "We are pursuing SOC 2") }), "soc2").status).toBe("in_progress");
    expect(fw(withFacts({ compliance: f("in_progress", "Compliance is underway") }), "soc2").status).toBe("in_progress");
  });

  it("marks a framework as likely, and says it is our inference, from other signals", () => {
    const sells = fw(withFacts({ compliance: f("none_visible"), enterprisePlan: f(true, "Enterprise plan") }), "soc2");
    expect(sells).toMatchObject({ status: "likely", basis: "inferred", quote: "Enterprise plan" });
    expect(fw(withFacts({ sellsEu: f(true, "We serve Europe") }), "gdpr")).toMatchObject({ status: "likely", basis: "inferred", quote: "We serve Europe" });
    expect(fw(withFacts({ healthData: f(true, "patient records") }), "hipaa")).toMatchObject({ status: "likely", basis: "inferred" });
    expect(fw(withFacts({ payments: f(true, "card payments") }), "pci")).toMatchObject({ status: "likely", basis: "inferred" });
  });

  it("prefers what the company states over what we infer", () => {
    expect(fw(withFacts({ gdprStated: f(true, "We comply with GDPR"), sellsEu: f(true) }), "gdpr")).toMatchObject({ status: "held", basis: "stated" });
    expect(fw(withFacts({ hipaaStated: f(true, "HIPAA compliant"), healthData: f(true) }), "hipaa").basis).toBe("stated");
  });

  it("ignores a low-confidence fact, so a guess never becomes a status", () => {
    const i = withFacts({ compliance: { value: "soc2_type2", confidence: "low", quotes: ["x"] } });
    expect(fw(i, "soc2").status).toBe("not_indicated");
  });

  it("says nothing is indicated when there is nothing to go on", () => {
    expect(buildIntel(BASE).frameworks.every((x) => x.status === "not_indicated")).toBe(true);
  });

  it("flags a framework no verified Sprinto claim covers, so nothing is promised about it", () => {
    const i = withFacts({ healthData: f(true, "patient records"), compliance: f("soc2_type2", "SOC 2") });
    expect(fw(i, "soc2").sprintoClaim).toBe(true);
    expect(fw(i, "gdpr").sprintoClaim).toBe(true);
    expect(fw(i, "hipaa").sprintoClaim).toBe(false);
    expect(fw(i, "pci").sprintoClaim).toBe(false);
    expect(buildIntel({ ...BASE, claims: [], facts: {} }).frameworks.some((x) => x.sprintoClaim)).toBe(false);
  });
});

describe("what it means for the conversation", () => {
  const stance = (facts: Record<string, ReturnType<typeof f>>) => withFacts(facts).stance;

  it.each([
    [{ compliance: f("soc2_iso", "q") }, /both big frameworks/, /Not getting certified/],
    [{ compliance: f("soc2_type2", "q") }, /SOC 2 Type 2 in hand/, /Upkeep/],
    [{ compliance: f("soc2_type1", "q") }, /Type 1 held/, /Type 2 window/],
    [{ compliance: f("iso_only", "q") }, /ISO 27001 held/, /SOC 2/],
    [{ compliance: f("in_progress", "q") }, /Mid-certification/, /Evidence collection/],
    [{ compliance: f("none_visible"), enterprisePlan: f(true, "q") }, /Sells upmarket/, /first customer/],
    [{ compliance: f("none_visible") }, /No compliance driver/, /trigger/],
    [{}, /not visible/, /find out/],
  ] as [Record<string, ReturnType<typeof f>>, RegExp, RegExp][])("gives the right advice for %#", (facts, headline, angle) => {
    const s = stance(facts);
    expect(s.headline).toMatch(headline);
    expect(s.angle).toMatch(angle);
    expect(s.caution.length).toBeGreaterThan(10);
  });

  it("points a SOC 2 holder who sells into the EU at the next framework", () => {
    expect(stance({ compliance: f("soc2_type2", "q"), sellsEu: f(true, "EU") }).angle).toMatch(/ISO 27001 or GDPR/);
  });
});

describe("how far from the next verdict, and what could move it", () => {
  it("says how many points short, and which unknowns could close the gap", () => {
    const p = buildIntel({ ...BASE, score: 50, missing: ["headcount", "securityHiring", "madeUpKey"] }).path;
    expect(p.next).toEqual({ label: "a strong fit, which carries on by itself", points: 15 });
    expect(p.unknowns.map((u) => u.key)).toEqual(["headcount", "securityHiring"]);
    expect(p.unknowns[0]).toMatchObject({ couldAdd: 10, label: "Company size" });
    expect(p.couldReach).toBe(67);
    expect(p.summary).toMatch(/15 short.*could add up to 17 points/);
  });

  it("is honest when even the best case would not get there", () => {
    const p = buildIntel({ ...BASE, score: 38, missing: ["newRegulatedMarket"] }).path;
    expect(p.next?.points).toBe(7);
    expect(p.summary).toMatch(/Even if everything.*reach 43/);
    // Exactly reaching the bar counts as reaching it.
    expect(buildIntel({ ...BASE, score: 40, missing: ["newRegulatedMarket"] }).path.summary).toMatch(/could add up to 5 points/);
    const q = buildIntel({ ...BASE, score: 30, missing: ["newRegulatedMarket"] }).path;
    expect(q.summary).toMatch(/unlikely to qualify/);
  });

  it("is honest when nothing unsaid could add points", () => {
    expect(buildIntel({ ...BASE, score: 55, missing: [] }).path.summary).toMatch(/nothing the site left unsaid could add points/);
  });

  it("has no gap for a strong fit, and says a rule-out is not about points", () => {
    expect(buildIntel({ ...BASE, score: 80, verdict: "qualified" }).path.next).toBeNull();
    expect(buildIntel({ ...BASE, score: 80, verdict: "qualified" }).path.summary).toMatch(/at or above/);
    expect(buildIntel({ ...BASE, score: 20, verdict: "not_fit" }).path.summary).toMatch(/rules this one out/);
  });

  it("uses the ICP version the company was scored under, and sensible defaults without one", () => {
    const custom = buildIntel({ ...BASE, score: 60, icp: { qualifyAt: 80, maybeAt: 50 } }).path;
    expect(custom.next?.points).toBe(20);
    const none = buildIntel({ ...BASE, score: 60, icp: null }).path;
    expect([none.maybeAt, none.qualifyAt]).toEqual([45, 65]);
    expect(buildIntel({ ...BASE, score: null }).path.summary).toMatch(/not been scored/);
  });

  it("never lets the best case go past 100", () => {
    expect(buildIntel({ ...BASE, score: 99, missing: ["headcount", "compliance"] }).path.couldReach).toBe(100);
  });
});

describe("the call plan", () => {
  const picks = [
    { id: "P6", label: "Repeated security questionnaires from prospects", evidence: [{ id: "e", text: "t", quotes: ["Enterprise Plus"] }] },
    { id: "P4", label: "A second or third framework repeats the same work", evidence: [{ id: "e", text: "t", quotes: ["Antwerp"] }] },
  ];

  it("opens with their own words and asks about what is happening for them", () => {
    const p = buildIntel({ ...BASE, hook: { quote: "We launched Cloud", source: "https://x.com/about" }, whyNow: [{ text: "A security role is open", quote: "Head of Security wanted" }] }).plan;
    expect(p.opener).toMatchObject({ quote: "We launched Cloud", source: "https://x.com/about" });
    expect(p.steps[0]).toMatchObject({ title: "Open with what is happening for them" });
    expect(p.steps[0]!.ask).toBe("I read on your site: “Head of Security wanted”. What is behind that?");
    expect(p.steps[0]!.why).toBe("Signal: A security role is open.");
    // Without a quote it says what was seen rather than inventing words.
    const bare = buildIntel({ ...BASE, whyNow: [{ text: "A security role is open", quote: null }] }).plan.steps[0]!;
    expect(bare.ask).toMatch(/^I noticed a sign on your site: a security role is open\./);
  });

  it("asks the framework question that matches where they stand", () => {
    const ask = (facts: Record<string, ReturnType<typeof f>>) => withFacts(facts).plan.steps.find((s) => s.title === "Find where they stand")!.ask;
    expect(ask({ compliance: f("in_progress", "q") })).toMatch(/audit date/);
    expect(ask({ compliance: f("soc2_type2", "q") })).toMatch(/Between audits/);
    expect(ask({ compliance: f("none_visible"), enterprisePlan: f(true, "q") })).toMatch(/security report most recently/);
    expect(ask({ compliance: f("iso_only", "q") })).toMatch(/SOC 2/);
    expect(ask({})).toMatch(/Which frameworks/);
  });

  it("adds the angle that applies, and the two pains' own questions", () => {
    const titles = withFacts({ sellsEu: f(true, "EU") }, { picks }).plan.steps.map((s) => s.title);
    expect(titles).toContain("Check the EU angle");
    expect(titles).toContain(picks[0]!.label);
    expect(titles).toContain(picks[1]!.label);
    expect(withFacts({ healthData: f(true, "x") }).plan.steps.map((s) => s.title)).toContain("Check the health-data angle");
    expect(withFacts({ payments: f(true, "x") }).plan.steps.map((s) => s.title)).toContain("Check the payments angle");
    expect(withFacts({ sellsEu: f(true, "x") }).plan.steps.length).toBeLessThanOrEqual(6);
  });

  it("brings only verified claims, and says plainly when there are none", () => {
    expect(buildIntel({ ...BASE }).plan.bring).toEqual(["Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies. (verified)"]);
    expect(buildIntel({ ...BASE, claims: [] }).plan.bring[0]).toMatch(/bring questions, not promises/);
  });

  it("suggests the next step with the next person, or asks who else to bring", () => {
    expect(buildIntel({ ...BASE, group: [{ name: "D. S.", title: "Director of Engineering", roleLabel: "Head of engineering" }] }).plan.nextStep).toMatch(/20 minutes with Director of Engineering \(Head of engineering\)/);
    expect(buildIntel({ ...BASE }).plan.nextStep).toMatch(/Ask who else should join/);
  });
});

describe("how much the brief rests on evidence", () => {
  const FULL = ["product", "audience", "customerData", "headcount", "compliance", "securityHiring"].reduce((o, k) => ({ ...o, [k]: f("x", "q") }), {} as Record<string, ReturnType<typeof f>>);
  const picks = [1, 2].map((n) => ({ id: `P${n}`, label: "l", evidence: [{ id: "e", text: "t", quotes: ["q"] }] }));

  it("is full when everything is evidenced", () => {
    const c = withFacts(FULL, { picks, hook: { quote: "q", source: null }, contact: { name: "A", title: "CISO", verification: "valid", checkedValid: false }, pagesRead: 6 }).confidence;
    expect(c).toMatchObject({ percent: 100, label: "Well supported" });
    expect(c.reasons.every((r) => r.ok)).toBe(true);
  });

  it("is thin, and says so, when little was read", () => {
    const c = buildIntel({ ...BASE, pagesRead: 1 }).confidence;
    expect(c.percent).toBe(0);
    expect(c.label).toMatch(/Thin/);
    expect(c.reasons.filter((r) => !r.ok)).toHaveLength(5);
  });

  it("counts a paid address check as verification, and each missing part costs its weight", () => {
    const base = { picks, hook: { quote: "q", source: null }, pagesRead: 6 };
    expect(withFacts(FULL, { ...base, contact: { name: "A", title: "x", verification: "accept_all", checkedValid: true } }).confidence.percent).toBe(100);
    expect(withFacts(FULL, { ...base, contact: { name: "A", title: "x", verification: "accept_all", checkedValid: false } }).confidence.percent).toBe(80);
    expect(withFacts(FULL, { ...base, contact: null }).confidence.percent).toBe(80);
  });
});

describe("objections this company's evidence makes likely", () => {
  const says = (i: ReturnType<typeof buildIntel>) => i.extraObjections.map((o) => o.says);

  it("adds the ones that apply, and only those", () => {
    expect(says(buildIntel(BASE))).toEqual([]);
    expect(says(withFacts({ compliance: f("soc2_type2", "q") }))).toContain("We already have our certifications, so we are fine.");
    expect(says(withFacts({ sellsEu: f(true, "EU") }))).toContain("Our EU customers have not asked for anything specific.");
    expect(says(buildIntel({ ...BASE, usesCompetitor: { quote: "Powered by a rival" } }))).toContain("We already use a compliance tool.");
  });

  it("warns against promising HIPAA or PCI unless a verified claim covers it", () => {
    expect(says(withFacts({ healthData: f(true, "x") }))).toContain("Do you cover HIPAA or PCI?");
    expect(says(withFacts({ healthData: f(true, "x") }, { claims: ["Sprinto automates HIPAA compliance"] }))).not.toContain("Do you cover HIPAA or PCI?");
  });

  it("describes a competing tool without disparaging it", () => {
    const c = buildIntel({ ...BASE, usesCompetitor: { quote: "q" } }).compete!;
    expect(c.quote).toBe("q");
    expect(c.play).toMatch(/Do not disparage/);
    expect(buildIntel(BASE).compete).toBeNull();
  });
});

describe("what the intelligence never does", () => {
  it("makes no statement about Sprinto of its own, only the verified claims it is handed", () => {
    const facts = { compliance: f("soc2_type1", "q"), sellsEu: f(true, "q"), healthData: f(true, "q"), payments: f(true, "q"), enterprisePlan: f(true, "q"), securityHiring: f("security_role", "q") };
    const i = buildIntel({ ...BASE, facts, claims: [], usesCompetitor: { quote: "q" }, picks: [{ id: "P6", label: "Repeated security questionnaires", evidence: [{ id: "e", text: "t", quotes: ["q"] }] }], group: [{ name: "x", title: "CTO", roleLabel: "CTO" }], hook: { quote: "q", source: null }, whyNow: [{ text: "Hiring", quote: "q" }] });
    // The one place the name may appear is the plain note that no claim is verified yet.
    expect(i.plan.bring[0]).toMatch(/No Sprinto claim has been verified/);
    expect(JSON.stringify({ ...i, plan: { ...i.plan, bring: [] } })).not.toMatch(/Sprinto/);
  });
});
