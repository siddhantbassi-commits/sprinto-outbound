import type { Role } from "@/lib/contacts/rank";
import { use } from "@/lib/icp/score";
import type { Facts } from "@/lib/icp/types";

/**
 * Step 5's fixed library. The pains are not invented by the model: each is a known compliance problem tied to signals
 * the facts can show. Code scores all nine for this person, keeps four, and only then asks Gemini to choose two.
 * The persona weights are a researched hypothesis (docs/Sprinto-Outbound-Scope.md section 5), to tune on real replies.
 */

export type PainId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9";
export type SignalId = "enterprise" | "noCert" | "certInProgress" | "smallTeam" | "noSecurityHire" | "oneCertHeld" | "regulated" | "friction" | "type1" | "securityRole" | "dataHeavy" | "sensitive" | "reportHeld";

export interface Evidence {
  /** The signal id; this is what the model cites and what code checks. */
  id: SignalId;
  text: string;
  /** Verbatim quotes already verified against the pages. Empty for facts code confirmed by absence. */
  quotes: string[];
  kind: "quote" | "code_checked";
}

interface SignalDef {
  id: SignalId;
  text: string;
  test(f: Facts): { hit: boolean; quotes: string[] };
}

const quotesOf = (...facts: { quotes: string[] }[]) => facts.flatMap((f) => f.quotes);
const is = <T>(fact: Facts[keyof Facts] & { value: T | null }, ...values: T[]) => values.includes(use(fact as never) as T);

export const SIGNALS: SignalDef[] = [
  {
    id: "enterprise",
    text: "Sells to larger customers (an Enterprise plan, named enterprise customers, or SSO/SAML/SCIM)",
    test: (f) => {
      const hits = [f.enterprisePlan, f.enterpriseLogos, f.enterpriseSecurity].filter((x) => use(x) === true);
      return { hit: hits.length > 0, quotes: quotesOf(...hits) };
    },
  },
  { id: "noCert", text: "No SOC 2 or ISO 27001 is visible on the site", test: (f) => ({ hit: use(f.compliance) === "none_visible", quotes: [] }) },
  { id: "certInProgress", text: "A certification is in progress", test: (f) => ({ hit: use(f.compliance) === "in_progress", quotes: f.compliance.quotes }) },
  { id: "smallTeam", text: "A small team (under about 50 people)", test: (f) => ({ hit: is(f.headcount, "1-10", "11-50"), quotes: f.headcount.quotes }) },
  { id: "noSecurityHire", text: "No security or GRC role is open", test: (f) => ({ hit: use(f.securityHiring) === "none", quotes: [] }) },
  { id: "oneCertHeld", text: "One certification is already held", test: (f) => ({ hit: is(f.compliance, "soc2_type1", "iso_only", "soc2_type2"), quotes: f.compliance.quotes }) },
  {
    id: "regulated",
    text: "Sells into the EU, handles health data, or takes payments",
    test: (f) => {
      const hits = [f.sellsEu, f.healthData, f.payments].filter((x) => use(x) === true);
      return { hit: hits.length > 0, quotes: quotesOf(...hits) };
    },
  },
  { id: "friction", text: "Signs of security-review friction (questionnaires, request-access trust page)", test: (f) => ({ hit: use(f.securityFriction) === true, quotes: f.securityFriction.quotes }) },
  { id: "reportHeld", text: "A SOC 2 Type 2 report is already held", test: (f) => ({ hit: is(f.compliance, "soc2_type2", "soc2_iso"), quotes: f.compliance.quotes }) },
  { id: "type1", text: "A SOC 2 Type 1 is held, with Type 2 still ahead", test: (f) => ({ hit: use(f.compliance) === "soc2_type1", quotes: f.compliance.quotes }) },
  { id: "securityRole", text: "A security or GRC role is open", test: (f) => ({ hit: use(f.securityHiring) === "security_role", quotes: f.securityHiring.quotes }) },
  { id: "dataHeavy", text: "Holds customers' data", test: (f) => ({ hit: use(f.customerData) === "stated", quotes: f.customerData.quotes }) },
  {
    id: "sensitive",
    text: "Handles health or payment data",
    test: (f) => {
      const hits = [f.healthData, f.payments].filter((x) => use(x) === true);
      return { hit: hits.length > 0, quotes: quotesOf(...hits) };
    },
  },
];

export interface PainDef {
  id: PainId;
  /** The pain as a label, for the Why page and the trace. */
  label: string;
  /** The pain in the person's own words, which the email may lean on. */
  plain: string;
  signals: SignalId[];
  /**
   * Signals that contradict this pain's premise. If the facts show one, the pain is not offered at all, however many of its own
   * signals hit: telling a company it "cannot yet hand over a SOC 2 report" when it already holds one is wrong, not just weak.
   */
  unless?: SignalId[];
  /** 0 to 30: how much this pain is felt by each role. A missing role is 0. */
  persona: Partial<Record<Role, number>>;
}

export const PAINS: PainDef[] = [
  { id: "P1", label: "An enterprise deal is stalling on a missing or ageing security report", plain: "larger prospects asking for a SOC 2 report you cannot yet hand over", signals: ["enterprise", "noCert"], unless: ["reportHeld"], persona: { ceo: 30, cto: 30, coo: 20, security_lead: 15, eng_head: 10, grc: 5, it_head: 5 } },
  { id: "P2", label: "Audit preparation eats engineering time", plain: "engineers pulled off product work to gather audit evidence", signals: ["certInProgress", "smallTeam"], persona: { cto: 30, eng_head: 30, it_head: 15, ceo: 10, security_lead: 10, grc: 10, coo: 5 } },
  { id: "P3", label: "The founder is the accidental compliance owner", plain: "compliance landing on a founder or CTO who has no time for it", signals: ["smallTeam", "noSecurityHire"], persona: { ceo: 30, cto: 30, coo: 10, eng_head: 10, it_head: 5 } },
  { id: "P4", label: "A second or third framework repeats the same work", plain: "starting from scratch on a second framework after the first audit", signals: ["oneCertHeld", "regulated"], persona: { security_lead: 30, grc: 30, cto: 10, it_head: 10, eng_head: 5, coo: 5 } },
  { id: "P5", label: "Evidence is collected by screenshots and spreadsheets", plain: "audit evidence chased by hand through screenshots and spreadsheets", signals: ["certInProgress"], persona: { grc: 30, security_lead: 30, it_head: 10, cto: 10, eng_head: 10, coo: 5 } },
  { id: "P6", label: "Repeated security questionnaires from prospects", plain: "the same security questionnaire answered again for every prospect", signals: ["enterprise", "friction"], persona: { security_lead: 30, ceo: 30, grc: 20, cto: 15, coo: 15, eng_head: 5, it_head: 5 } },
  { id: "P7", label: "Staying compliant after the audit (continuous monitoring)", plain: "keeping controls passing between audits, not only on audit day", signals: ["type1"], persona: { security_lead: 30, grc: 30, it_head: 15, cto: 10, eng_head: 10 } },
  { id: "P8", label: "Hiring a first compliance owner is slow and costly", plain: "waiting months to hire someone to own compliance", signals: ["securityRole"], persona: { cto: 30, ceo: 30, eng_head: 20, coo: 15, it_head: 10, security_lead: 5, grc: 5 } },
  { id: "P9", label: "Vendor and third-party risk reviews pile up", plain: "vendor and third-party risk reviews piling up", signals: ["dataHeavy", "sensitive"], persona: { security_lead: 30, grc: 20, it_head: 20, cto: 10, eng_head: 5, coo: 5 } },
];

export const PAIN_BY_ID: Record<PainId, PainDef> = Object.fromEntries(PAINS.map((p) => [p.id, p])) as Record<PainId, PainDef>;

export const POINTS_PER_SIGNAL = 10;
export const SHORTLIST_SIZE = 4;

export interface ScoredPain {
  pain: PainDef;
  score: number;
  signalPoints: number;
  personaPoints: number;
  evidence: Evidence[];
}

/** Which signals the facts show, each with the quotes that earn it. */
export function detectSignals(facts: Facts): Evidence[] {
  const out: Evidence[] = [];
  for (const s of SIGNALS) {
    const r = s.test(facts);
    if (r.hit) out.push({ id: s.id, text: s.text, quotes: [...new Set(r.quotes)], kind: r.quotes.length > 0 ? "quote" : "code_checked" });
  }
  return out;
}

export function scorePains(facts: Facts, role: Role | null): ScoredPain[] {
  const signals = new Map(detectSignals(facts).map((e) => [e.id, e]));
  return PAINS.filter((pain) => !(pain.unless ?? []).some((id) => signals.has(id))).map((pain) => {
    const evidence = pain.signals.flatMap((id) => (signals.has(id) ? [signals.get(id) as Evidence] : []));
    const personaPoints = role ? (pain.persona[role] ?? 0) : 0;
    const signalPoints = evidence.length * POINTS_PER_SIGNAL;
    return { pain, score: signalPoints + personaPoints, signalPoints, personaPoints, evidence };
  });
}

export interface Shortlist {
  items: ScoredPain[];
  /** True when fewer than two pains have any evidence, so the choice rests mostly on the person's role. */
  thinEvidence: boolean;
}

/**
 * The top four. A pain with evidence always beats one without; among equals the higher persona weight wins, then the
 * lower id. So the same facts and role always give the same four, in the same order.
 */
export function shortlist(facts: Facts, role: Role | null): Shortlist {
  const scored = scorePains(facts, role);
  const ranked = [...scored].sort((a, b) => {
    const aHas = a.evidence.length > 0 ? 1 : 0;
    const bHas = b.evidence.length > 0 ? 1 : 0;
    return bHas - aHas || b.score - a.score || b.personaPoints - a.personaPoints || a.pain.id.localeCompare(b.pain.id);
  });
  const items = ranked.slice(0, SHORTLIST_SIZE);
  return { items, thinEvidence: scored.filter((s) => s.evidence.length > 0).length < 2 };
}
