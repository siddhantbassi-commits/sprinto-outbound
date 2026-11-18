import { ICP_V1, type IcpConfig } from "./config";
import type { Fact, Facts, Gate, Part, ScoreContext, ScoreResult } from "./types";

/**
 * Step 3's verdict. A pure function: the same facts, context and ICP version always give the same answer, so the model
 * can never move a score. Every point comes with the quotes that earned it.
 */

/** A fact counts only when it has a value and was not a low-confidence reading. */
export const use = <T>(f: Fact<T>): T | null => (f.value !== null && f.confidence !== "low" ? f.value : null);
const known = <T>(f: Fact<T>) => use(f) !== null;

export const KEY_FACTS = ["product", "headcount", "enterprise", "compliance", "securityHiring", "customerData"] as const;

/** Which of the six key facts are known. The agent loop runs while this is short. */
export function coverage(facts: Facts, cfg: IcpConfig = ICP_V1) {
  const isKnown: Record<(typeof KEY_FACTS)[number], boolean> = {
    product: known(facts.product),
    headcount: known(facts.headcount),
    enterprise: known(facts.enterprisePlan) || known(facts.enterpriseLogos) || known(facts.enterpriseSecurity),
    compliance: known(facts.compliance),
    securityHiring: known(facts.securityHiring),
    customerData: known(facts.customerData),
  };
  const missing = KEY_FACTS.filter((k) => !isKnown[k]);
  const knownCount = KEY_FACTS.length - missing.length;
  return { known: knownCount, missing: [...missing], enough: knownCount >= cfg.minKnownKeyFacts };
}

const SELLABLE = new Set(["saas", "platform", "api", "devtool", "infra"]);

function gates(facts: Facts, ctx: ScoreContext, cfg: IcpConfig): Gate[] {
  const product = use(facts.product);
  const audience = use(facts.audience);
  const out: Gate[] = [];

  if (product === null) out.push({ id: "G1", label: "B2B software product", status: "unknown", detail: "The pages do not say what the company sells." });
  else if (!SELLABLE.has(product)) out.push({ id: "G1", label: "B2B software product", status: "fail", detail: `Looks like ${product}, not a B2B software product.` });
  else if (audience === "consumer") out.push({ id: "G1", label: "B2B software product", status: "fail", detail: "Sold to consumers, not businesses." });
  else out.push({ id: "G1", label: "B2B software product", status: "pass", detail: `Product type: ${product}.` });

  const sprintoCustomer = use(facts.complianceVendor) === "sprinto";
  out.push(
    ctx.excludedDomain || sprintoCustomer
      ? { id: "G2", label: "Not excluded", status: "fail", detail: sprintoCustomer ? "Already uses Sprinto." : "On the blocklist (Sprinto, a competitor, an auditor or similar)." }
      : { id: "G2", label: "Not excluded", status: "pass", detail: "Not on the blocklist." },
  );

  out.push(
    ctx.suppressed
      ? { id: "G3", label: "Not suppressed", status: "fail", detail: "On the suppression list." }
      : { id: "G3", label: "Not suppressed", status: "pass", detail: "Not suppressed." },
  );

  const band = use(facts.headcount);
  out.push(
    band === "1000+"
      ? { id: "G4", label: "Headcount", status: "fail", detail: "Over 1,000 people: a large GRC team, not Sprinto's buyer." }
      : { id: "G4", label: "Headcount", status: "pass", detail: band ? `Estimated ${band} people.` : "Size unknown (flagged, not blocking)." },
  );

  const enough = ctx.textChars >= cfg.minChars && ctx.pages >= cfg.minPages;
  out.push(
    enough
      ? { id: "G5", label: "Enough to judge", status: "pass", detail: `${ctx.textChars} characters from ${ctx.pages} pages.` }
      : { id: "G5", label: "Enough to judge", status: "unknown", detail: `Only ${ctx.textChars} characters from ${ctx.pages} page(s); need ${cfg.minChars} from ${cfg.minPages}.` },
  );
  return out;
}

function parts(facts: Facts, cfg: IcpConfig): Part[] {
  const p = cfg.points;
  const out: Part[] = [];
  const add = (id: string, group: Part["group"], label: string, points: number, max: number, quotes: string[] = []) =>
    out.push({ id, group, label, points, max, quotes });

  // Fit (40)
  const data = use(facts.customerData);
  add("customerData", "fit", "Handles customer data in the cloud",
    data === "stated" ? p.customerData.stated : data === "implied" ? p.customerData.implied : 0, p.customerData.stated, facts.customerData.quotes);

  const plan = use(facts.enterprisePlan) === true;
  const logos = use(facts.enterpriseLogos) === true;
  const sec = use(facts.enterpriseSecurity) === true;
  add("enterprise", "fit", "Sells to businesses (enterprise plan, customer logos, SSO or audit logs)",
    (plan ? p.enterprise.plan : 0) + (logos ? p.enterprise.logos : 0) + (sec ? p.enterprise.security : 0),
    p.enterprise.plan + p.enterprise.logos + p.enterprise.security,
    [...(plan ? facts.enterprisePlan.quotes : []), ...(logos ? facts.enterpriseLogos.quotes : []), ...(sec ? facts.enterpriseSecurity.quotes : [])]);

  const band = use(facts.headcount);
  add("size", "fit", facts.headcount.source === "hunter_discover" && band ? `Company size (${band} per Hunter, not stated on the site)` : "Company size", band ? p.size[band] : 0, Math.max(...Object.values(p.size)), facts.headcount.quotes);

  // Need (40)
  const status = use(facts.compliance);
  add("status", "need", "Compliance status", status ? p.status[status] : 0, Math.max(...Object.values(p.status)), facts.compliance.quotes);

  const gapRaw =
    (use(facts.sellsEu) === true && use(facts.gdprStated) !== true ? p.gap.eu : 0) +
    (use(facts.healthData) === true && use(facts.hipaaStated) !== true ? p.gap.health : 0) +
    (use(facts.payments) === true && use(facts.pciStated) !== true ? p.gap.payments : 0);
  add("gap", "need", "A framework they do not yet mention (GDPR, HIPAA, PCI)", Math.min(gapRaw, p.gap.cap), p.gap.cap,
    [...facts.sellsEu.quotes, ...facts.healthData.quotes, ...facts.payments.quotes]);

  const hiring = use(facts.securityHiring);
  add("hiring", "need", "Hiring for security, compliance or IT",
    hiring === "security_role" ? p.hiring.security_role : hiring === "it_head" ? p.hiring.it_head : 0, p.hiring.security_role, facts.securityHiring.quotes);

  // Timing (20)
  add("recent", "timing", "Funding, launch or enterprise tier in the last year", use(facts.recentLaunchOrFunding) === true ? p.timing.recent : 0, p.timing.recent, facts.recentLaunchOrFunding.quotes);
  add("friction", "timing", "Security-review friction (questionnaires, request-access trust page)", use(facts.securityFriction) === true ? p.timing.friction : 0, p.timing.friction, facts.securityFriction.quotes);
  add("market", "timing", "New regulated market or region", use(facts.newRegulatedMarket) === true ? p.timing.market : 0, p.timing.market, facts.newRegulatedMarket.quotes);

  // Penalty
  add("competitor", "penalty", "A competitor's trust centre is visible", use(facts.complianceVendor) === "competitor" ? -p.competitorPenalty : 0, -p.competitorPenalty, facts.complianceVendor.quotes);
  return out;
}

export function scoreIcp(facts: Facts, ctx: ScoreContext, cfg: IcpConfig = ICP_V1): ScoreResult {
  const g = gates(facts, ctx, cfg);
  const ps = parts(facts, cfg);
  const cov = coverage(facts, cfg);
  const flags: string[] = [];
  if (!known(facts.headcount)) flags.push("Company size is unknown");
  if (use(facts.headcount) !== null && facts.headcount.confidence === "medium") flags.push(facts.headcount.source === "hunter_discover" ? "Company size comes from Hunter, not the company's site" : "Company size is an estimate");

  const raw = ps.reduce((sum, x) => sum + x.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const base = { score, parts: ps, gates: g, missing: cov.missing, flags, icpVersion: cfg.version };

  const failed = g.find((x) => x.status === "fail");
  if (failed) return { ...base, score: 0, verdict: "not_fit", reason: `${failed.label}: ${failed.detail}` };

  const unknownGate = g.find((x) => x.status === "unknown");
  if (unknownGate) return { ...base, verdict: "needs_more", reason: `${unknownGate.label}: ${unknownGate.detail}` };

  if (!cov.enough) {
    return { ...base, verdict: "needs_more", reason: `Only ${cov.known} of ${KEY_FACTS.length} key facts known. Missing: ${cov.missing.join(", ")}.` };
  }
  if (score >= cfg.qualifyAt) return { ...base, verdict: "qualified", reason: `Scored ${score}, at or above ${cfg.qualifyAt}.` };
  if (score >= cfg.maybeAt) return { ...base, verdict: "maybe", reason: `Scored ${score}, between ${cfg.maybeAt} and ${cfg.qualifyAt - 1}: needs a person.` };
  return { ...base, verdict: "not_fit", reason: `Scored ${score}, below ${cfg.maybeAt}.` };
}
