import { describe, expect, it } from "vitest";
import { buildBrief, type BriefInput } from "@/lib/brief/build";
import { buildComparison, MAX_COMPARE, parseCompareIds } from "@/lib/brief/compare";

const fact = (value: unknown, quote = "q") => ({ value, confidence: "high", quotes: [quote] });
const mk = (domain: string, over: Partial<BriefInput> = {}): BriefInput => ({
  domain,
  pages: [{ url: `https://${domain}/`, kind: "home", title: `${domain[0]!.toUpperCase()}${domain.split(".")[0]!.slice(1)} | Software`, text: "We are a platform. q" }],
  lane: "review", verdict: "maybe", score: 50, scoreReason: "x",
  parts: [], missing: [], facts: { compliance: fact("none_visible") }, contact: { name: "A B", title: "CTO", email: "a@x.io", verification: "valid", confidence: 90, source: "hunter", rankScore: 80 },
  candidates: 1, picks: [], email: null, claims: ["Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies."], unverifiedClaims: 0,
  ...over,
});
const item = (id: string, domain: string, over: Partial<BriefInput> = {}) => ({ id, lane: "review", brief: buildBrief(mk(domain, over)) });

describe("lining companies up", () => {
  const a = item("a", "alpha.io", { verdict: "qualified", score: 90, facts: { compliance: fact("in_progress", "working towards SOC 2"), sellsEu: fact(true) } });
  const b = item("b", "beta.io", { verdict: "maybe", score: 62, facts: { compliance: fact("soc2_type2", "SOC 2 Type 2") }, contact: null });
  const c = item("c", "gamma.io", { verdict: "not_fit", score: 20, facts: { compliance: fact("none_visible") }, parts: [{ id: "x", group: "penalty", label: "Uses a competitor", points: -15, max: -15, quotes: ["Powered by a rival"] }] });

  it("names the strongest fit and how far ahead it is", () => {
    const r = buildComparison([b, a, c]);
    expect(r.leader).toEqual({ id: "a", name: "Alpha", score: 90 });
    expect(r.verdictLine).toBe("Alpha is the strongest fit at 90, 28 points ahead of Beta (62).");
    expect(r.bestScore).toEqual(["a"]);
  });

  it("breaks a tie on score by the better-evidenced brief, and says they are level", () => {
    const weak = item("w", "weak.io", { verdict: "maybe", score: 70, pages: [] });
    const strong = item("s", "strong.io", { verdict: "maybe", score: 70 });
    const r = buildComparison([weak, strong]);
    expect(r.bestScore.sort()).toEqual(["s", "w"]);
    expect(r.verdictLine).toMatch(/level with/);
    expect(r.leader?.score).toBe(70);
  });

  it("says plainly when nothing is scored, or only one thing is", () => {
    const none = buildComparison([item("n1", "n1.io", { score: null, verdict: "needs_more" }), item("n2", "n2.io", { score: null, verdict: "needs_more" })]);
    expect(none.leader).toBeNull();
    expect(none.verdictLine).toMatch(/nothing to rank/);
    expect(buildComparison([a, item("n", "n.io", { score: null, verdict: "needs_more" })]).verdictLine).toBe("Alpha is the only one scored, at 90.");
  });

  it("states in words where the companies differ, framework by framework", () => {
    const d = buildComparison([a, b, c]).differences;
    expect(d.find((x) => x.startsWith("SOC 2:"))).toMatch(/Beta holds it.*Alpha has it in progress/);
    expect(d.find((x) => x.startsWith("GDPR:"))).toMatch(/Alpha probably needs it/);
    // Several companies take the plural verb.
    const d2 = buildComparison([a, b, item("d", "delta.io", { verdict: "maybe", score: 55, facts: { compliance: fact("none_visible"), sellsEu: fact(true) } })]).differences;
    expect(d2.find((x) => x.startsWith("GDPR:"))).toBe("GDPR: Alpha and Delta probably need it; Beta shows no sign of needing it.");
    expect(d2.find((x) => x.startsWith("GDPR:"))).not.toMatch(/probably needs it/);
    expect(d.find((x) => x.startsWith("Contact:"))).toBe("Contact: Beta has no named person yet; the others do.");
    expect(d.find((x) => x.startsWith("Competitor:"))).toMatch(/Gamma already seems to use a rival tool/);
    expect(d.find((x) => x.startsWith("Conversation:"))).toMatch(/Alpha is "Mid-certification/);
    // Names like SOC 2 keep their capitals.
    expect(d.find((x) => x.startsWith("Conversation:"))).toMatch(/Beta is "SOC 2 Type 2 in hand"/);
  });

  it("says nothing about a framework or a trait they all share", () => {
    const x = item("x", "x.io"), y = item("y", "y.io");
    const d = buildComparison([x, y]).differences;
    expect(d.filter((l) => /^(SOC 2|ISO 27001|GDPR|HIPAA|PCI DSS|Contact|Competitor|Conversation):/.test(l))).toEqual([]);
  });

  it("shows the gap to a strong fit only for those not already there", () => {
    const r = buildComparison([a, b]);
    expect(r.columns.find((c) => c.id === "a")!.shortBy).toBeNull();
    expect(r.columns.find((c) => c.id === "b")!.shortBy).toBe(3);
  });

  it("carries each company's evidence figure, contact, and framework statuses", () => {
    const col = buildComparison([a, b]).columns[1]!;
    expect(col.frameworks.soc2.status).toBe("held");
    expect(col.contact).toBeNull();
    expect(col.confidence).toBeGreaterThanOrEqual(0);
    expect(buildComparison([a, b]).columns[0]!.contact).toEqual({ name: "A B", title: "CTO" });
  });

  it("never takes more than four, and does not mutate what it is given", () => {
    const many = Array.from({ length: 7 }, (_, k) => item(`i${k}`, `co${k}.io`, { score: 10 * k }));
    const copy = [...many];
    expect(buildComparison(many).columns).toHaveLength(MAX_COMPARE);
    expect(many).toEqual(copy);
  });
});

describe("reading the companies out of a link", () => {
  const ID1 = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222", ID3 = "33333333-3333-4333-8333-333333333333";

  it("takes repeated and comma-separated ids, once each, in order, in lower case", () => {
    expect(parseCompareIds([ID1, ID2.toUpperCase(), ID1]).ids).toEqual([ID1, ID2]);
    expect(parseCompareIds(`${ID1},${ID2}, ${ID3}`).ids).toEqual([ID1, ID2, ID3]);
    expect(parseCompareIds(ID1).ids).toEqual([ID1]);
  });

  it("drops anything that is not an id, so nothing odd reaches the database", () => {
    expect(parseCompareIds(["x", "../../etc", "1; drop table prospects", "", ID1]).ids).toEqual([ID1]);
    expect(parseCompareIds(undefined)).toEqual({ ids: [], dropped: 0 });
  });

  it("keeps the first four and says how many it dropped", () => {
    const ids = Array.from({ length: 6 }, (_, k) => `${String(k + 1).repeat(8)}-1111-4111-8111-111111111111`);
    const r = parseCompareIds(ids);
    expect(r.ids).toHaveLength(4);
    expect(r.dropped).toBe(2);
  });
});
