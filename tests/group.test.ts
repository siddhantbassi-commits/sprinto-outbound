import { describe, expect, it } from "vitest";
import { buildBrief, briefToText, type BriefInput } from "@/lib/brief/build";
import { buildGroup, ROLE_LABEL, type GroupCandidate } from "@/lib/brief/group";
import { FRAMING } from "@/lib/brief/library";
import { emptyFacts, type Facts } from "@/lib/icp/types";

const facts = (over: Partial<Facts> = {}): Facts => ({
  ...emptyFacts(),
  enterprisePlan: { value: true, confidence: "high", quotes: ["The Enterprise plan includes SSO"] },
  securityFriction: { value: true, confidence: "high", quotes: ["Request access to our security report"] },
  compliance: { value: "in_progress", confidence: "high", quotes: ["We are working toward SOC 2"] },
  headcount: { value: "11-50", confidence: "high", quotes: ["a team of 30"] },
  ...over,
});
const cand = (name: string, title: string | null, rankScore: number | null, over: Partial<GroupCandidate> = {}): GroupCandidate => ({ name, title, email: `${name.split(" ")[0]!.toLowerCase()}@acme.io`, rankScore, source: "hunter", verification: "valid", ...over });

describe("the other people worth speaking to", () => {
  const f = facts();

  it("lists the best-ranked first and no more than three by default", () => {
    const g = buildGroup({ candidates: [cand("A One", "CTO", 40), cand("B Two", "Head of Security", 80), cand("C Three", "CEO", 60), cand("D Four", "COO", 20)], facts: f, avoid: [] });
    expect(g.map((m) => m.name)).toEqual(["B Two", "C Three", "A One"]);
    expect(buildGroup({ candidates: [cand("A", "CTO", 1), cand("B", "CEO", 2)], facts: f, avoid: [], max: 1 })).toHaveLength(1);
  });

  it("matches a person to the pain their role feels most among those with evidence", () => {
    const [sec] = buildGroup({ candidates: [cand("Sam Lee", "Head of Security", 80)], facts: f, avoid: [] });
    expect(sec!.role).toBe("security_lead");
    expect(sec!.roleLabel).toBe(ROLE_LABEL.security_lead);
    // P6 (questionnaires: enterprise + friction) is the strongest evidenced pain for a security lead on these facts.
    expect(sec!.angle).toMatchObject({ id: "P6", framing: FRAMING.P6 });
    expect(sec!.angle!.evidence.length).toBeGreaterThan(0);
    expect(sec!.angle!.evidence.some((e) => e.quote?.includes("Enterprise plan"))).toBe(true);
  });

  it("prefers a pain the first email did not use, and says when it could not", () => {
    const [different] = buildGroup({ candidates: [cand("Sam Lee", "Head of Security", 80)], facts: f, avoid: ["P6"] });
    expect(different!.angle!.id).not.toBe("P6");
    expect(different!.why).toMatch(/different angle from the first email/);
    const only = { ...emptyFacts(), securityFriction: { value: true, confidence: "high" as const, quotes: ["Request access to our security report"] } };
    const [same] = buildGroup({ candidates: [cand("Sam Lee", "Head of Security", 80)], facts: only, avoid: ["P6"] });
    expect(same!.angle!.id).toBe("P6");
    expect(same!.why).toMatch(/same pain the first email uses; no other has evidence/);
  });

  it("gives a title that owns no compliance, or a site with nothing to go on, the general questions instead of an invented angle", () => {
    const [marketing] = buildGroup({ candidates: [cand("Mo Day", "VP Marketing", 30)], facts: f, avoid: [] });
    expect(marketing).toMatchObject({ role: null, angle: null });
    expect(marketing!.why).toMatch(/general questions/);
    const [blank] = buildGroup({ candidates: [cand("Sam Lee", "Head of Security", 80)], facts: emptyFacts(), avoid: [] });
    expect(blank!.angle).toBeNull();
    expect(blank!.why).toMatch(/no evidence/);
    expect(buildGroup({ candidates: [cand("Sam Lee", "Head of Security", 80)], facts: null, avoid: [] })[0]!.angle).toBeNull();
  });

  it("says how far to trust each address, and never shows one the caller did not have", () => {
    const g = buildGroup({ candidates: [cand("A One", "CTO", 3, { verification: "accept_all" }), cand("B Two", "CEO", 2, { source: "manual", verification: null }), cand("C Three", "COO", 1, { email: null, verification: null })], facts: f, avoid: [] });
    expect(g[0]!.trust).toBe("Hunter could not fully verify the address (accept_all)");
    expect(g[1]!.trust).toBe("Hand-picked by a person");
    expect(g[2]!.trust).toBe("Address not verified");
    expect(g[2]!.email).toBeNull();
  });

  it("is empty when there is no one else", () => {
    expect(buildGroup({ candidates: [], facts: f, avoid: [] })).toEqual([]);
  });
});

describe("the brief with a group and a checked address", () => {
  const base = (over: Partial<BriefInput> = {}): BriefInput => ({
    domain: "acme.io", pages: [{ url: "https://acme.io/", kind: "home", title: "Acme", text: "Acme is a workflow platform for engineering teams that ship fast every day." }],
    lane: "review", verdict: "qualified", score: 80, scoreReason: "", parts: [], missing: [], facts: null,
    contact: { id: "c1", name: "Ana Rao", title: "CTO", email: "ana@acme.io", verification: "accept_all", confidence: 70, source: "hunter", rankScore: 80 },
    candidates: 3, picks: [{ id: "P2", label: "Audit preparation eats engineering time", plain: "x", reason: "y", evidence: [{ id: "certInProgress", text: "A certification is in progress", quotes: ["We are working toward SOC 2"], kind: "quote" }] }],
    email: null, claims: [], unverifiedClaims: 0,
    others: [cand("Sam Lee", "Head of Security", 80)], rawFacts: facts(),
    ...over,
  });

  it("includes the group, with the first email's pains avoided where it can", () => {
    const b = buildBrief(base());
    expect(b.group).toHaveLength(1);
    expect(b.group[0]!.angle!.id).not.toBe("P2");
    expect(briefToText(b)).toMatch(/ALSO WORTH SPEAKING TO[\s\S]*Sam Lee, Head of Security[\s\S]*Lead with:/);
  });

  it("suggests paying to check an address Hunter could not vouch for, and not one that is already valid or already checked", () => {
    expect(buildBrief(base()).contact!.shouldVerify).toBe(true);
    expect(buildBrief(base({ contact: { id: "c1", name: "A", title: "CTO", email: "a@acme.io", verification: "valid", confidence: 95, source: "hunter", rankScore: 1 } })).contact!.shouldVerify).toBe(false);
    expect(buildBrief(base({ verified: { status: "valid", score: 97, at: "2026-11-18T10:00:00Z" } })).contact!.shouldVerify).toBe(false);
    expect(buildBrief(base({ contact: { id: "c1", name: "A", title: "CTO", email: null, verification: null, confidence: null, source: "hunter", rankScore: 1 } })).contact!.shouldVerify).toBe(false);
  });

  it("shows the paid check over what Hunter said when it found the address", () => {
    expect(buildBrief(base({ verified: { status: "valid", score: 97, at: "x" } })).contact!.trust).toBe("Checked with Hunter's verifier: the address is valid (97% sure)");
    expect(buildBrief(base({ verified: { status: "invalid", score: 3, at: "x" } })).contact!.trust).toMatch(/invalid\. Do not use it/);
    expect(buildBrief(base({ verified: { status: "accept_all", score: 50, at: "x" } })).contact!.trust).toMatch(/accept all, so it still cannot be vouched for/);
  });

  it("warns on a call when the rubric found that they already use a competitor, with their own words", () => {
    const parts = [{ id: "competitor", group: "penalty", label: "A competitor's trust centre is visible", points: -15, max: -15, quotes: ["Secured by Vanta"] }];
    const b = buildBrief(base({ parts }));
    expect(b.fit.usesCompetitor).toMatchObject({ text: "A competitor's trust centre is visible", quote: "Secured by Vanta" });
    expect(briefToText(b)).toContain('Caution: they already seem to use a competitor ("Secured by Vanta").');
    expect(buildBrief(base()).fit.usesCompetitor).toBeNull();
    expect(buildBrief(base({ parts: [{ ...parts[0]!, points: 0 }] })).fit.usesCompetitor).toBeNull();
  });
});
