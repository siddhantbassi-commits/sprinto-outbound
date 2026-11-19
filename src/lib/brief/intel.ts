/**
 * The deal intelligence in a discovery-call brief: where the company stands on each compliance framework, what that means for the
 * conversation, how far the fit score is from the next verdict and what could move it, a call plan, and how much the whole brief
 * rests on evidence. Everything is built by code from facts the pipeline already recorded, each with its quote, so a statement here
 * is either read off the company's own pages or labelled as an inference, with the reason. Nothing here is a claim about Sprinto:
 * the only thing said about Sprinto is a verified claim, and a framework no verified claim covers is flagged "do not promise".
 * Pure, so every rule is tested.
 */

import type { PainId } from "@/lib/pitch/pains";
import { FRAMING, QUESTIONS, UNIVERSAL_QUESTIONS } from "./library";

type FactRec = Record<string, { value: unknown; confidence: string; quotes: string[]; source?: string }> | null;

export interface IntelInput {
  facts: FactRec;
  pages: { url: string; text: string }[];
  verdict: string | null;
  score: number | null;
  /** The thresholds and point values of the ICP version this company was scored under. */
  icp?: { qualifyAt: number; maybeAt: number; points?: IcpPoints } | null;
  missing: string[];
  picks: { id: string; label: string; evidence: { id: string; text: string; quotes: string[] }[] }[];
  whyNow: { text: string; quote: string | null }[];
  hook: { quote: string | null; source: string | null } | null;
  claims: string[];
  group: { title: string | null; roleLabel: string | null; name: string }[];
  contact: { name: string; title: string | null; verification: string | null; checkedValid: boolean } | null;
  usesCompetitor: { quote: string | null } | null;
  /** How many key facts are known, for the confidence meter. */
  pagesRead: number;
}

export interface IcpPoints {
  customerData?: { stated: number; implied: number };
  enterprise?: { plan: number; logos: number; security: number };
  size?: Record<string, number>;
  status?: Record<string, number>;
  gap?: { eu: number; health: number; payments: number; cap: number };
  hiring?: { security_role: number; it_head: number };
  timing?: { recent: number; friction: number; market: number };
}

export type FwId = "soc2" | "iso27001" | "gdpr" | "hipaa" | "pci";
export type FwStatus = "held" | "in_progress" | "likely" | "not_indicated";

export interface FrameworkRow {
  id: FwId;
  name: string;
  status: FwStatus;
  /** "stated": the company's own page says so. "inferred": our rule, from other signals, with the reason shown. */
  basis: "stated" | "inferred" | "none";
  headline: string;
  because: string | null;
  quote: string | null;
  source: string | null;
  /** Whether a verified claim about Sprinto covers this framework. If not, nothing may be promised about it. */
  sprintoClaim: boolean;
}

export interface Stance {
  headline: string;
  angle: string;
  caution: string;
}

export interface PathToVerdict {
  score: number | null;
  maybeAt: number;
  qualifyAt: number;
  next: { label: string; points: number } | null;
  unknowns: { key: string; label: string; couldAdd: number }[];
  couldReach: number | null;
  summary: string;
}

export interface PlanStep {
  title: string;
  ask: string;
  why: string;
}

export interface CallPlan {
  opener: { line: string; quote: string | null; source: string | null } | null;
  steps: PlanStep[];
  bring: string[];
  nextStep: string;
  followUp: string;
}

export interface Confidence {
  percent: number;
  label: string;
  reasons: { ok: boolean; text: string }[];
}

export interface Intel {
  frameworks: FrameworkRow[];
  stance: Stance;
  path: PathToVerdict;
  plan: CallPlan;
  confidence: Confidence;
  compete: { quote: string | null; play: string } | null;
  extraObjections: { says: string; response: string }[];
}

const FW_NAME: Record<FwId, string> = { soc2: "SOC 2", iso27001: "ISO 27001", gdpr: "GDPR", hipaa: "HIPAA", pci: "PCI DSS" };
const FW_WORDS: Record<FwId, RegExp> = { soc2: /soc ?2/i, iso27001: /iso ?\/?(iec)? ?27001/i, gdpr: /gdpr/i, hipaa: /hipaa/i, pci: /pci/i };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function buildIntel(i: IntelInput): Intel {
  const known = (k: string) => (i.facts?.[k] && i.facts[k]!.confidence !== "low" ? i.facts[k]!.value : null);
  const quoteOf = (k: string) => (known(k) !== null ? (i.facts?.[k]?.quotes[0] ?? null) : null);
  const sourceOf = (quote: string | null) => (quote ? (i.pages.find((p) => norm(p.text).includes(norm(quote)))?.url ?? null) : null);
  const claimCovers = (id: FwId) => i.claims.some((c) => FW_WORDS[id].test(c));

  const comp = known("compliance") as string | null;
  const compQuote = quoteOf("compliance");
  const upmarket = known("enterprisePlan") === true || known("enterpriseLogos") === true || known("enterpriseSecurity") === true || known("securityFriction") === true;
  const upmarketQuote = quoteOf("enterprisePlan") ?? quoteOf("enterpriseLogos") ?? quoteOf("securityFriction") ?? quoteOf("enterpriseSecurity");
  const eu = known("sellsEu") === true;
  const health = known("healthData") === true;
  const pay = known("payments") === true;

  const row = (id: FwId, status: FwStatus, basis: FrameworkRow["basis"], headline: string, because: string | null, quote: string | null): FrameworkRow => ({
    id, name: FW_NAME[id], status, basis, headline, because, quote, source: sourceOf(quote), sprintoClaim: claimCovers(id),
  });

  // SOC 2
  const soc2Held = comp === "soc2_type1" || comp === "soc2_type2" || comp === "soc2_iso";
  const isoHeld = comp === "iso_only" || comp === "soc2_iso";
  const soc2: FrameworkRow = soc2Held
    ? row("soc2", "held", "stated", comp === "soc2_type1" ? "SOC 2 Type 1 held" : "SOC 2 Type 2 held", comp === "soc2_type1" ? "A Type 1 report shows controls exist on one day. Type 2 shows they work over months, and is what larger buyers usually ask for next." : "A report is in hand, so the work now is keeping evidence current and answering buyers fast.", compQuote)
    : comp === "in_progress" && !(compQuote && FW_WORDS.iso27001.test(compQuote) && !FW_WORDS.soc2.test(compQuote))
      ? row("soc2", "in_progress", "stated", "SOC 2 in progress", "The page says a certification is under way. This is the most painful moment: evidence collection and audit dates are live.", compQuote)
      : upmarket && !soc2Held
        ? row("soc2", "likely", "inferred", "Likely to be asked for", "They sell to larger customers, which usually ask for a SOC 2 report before signing.", upmarketQuote)
        : row("soc2", "not_indicated", "none", "No sign it is needed yet", null, null);

  // ISO 27001
  const iso: FrameworkRow = isoHeld
    ? row("iso27001", "held", "stated", "ISO 27001 held", "Already certified, so a second framework is no longer the opening.", compQuote)
    : comp === "in_progress" && compQuote && FW_WORDS.iso27001.test(compQuote)
      ? row("iso27001", "in_progress", "stated", "ISO 27001 in progress", "The page says it is working towards this.", compQuote)
      : eu
        ? row("iso27001", "likely", "inferred", "Common ask from EU buyers", "They sell into the EU, where ISO 27001 is a frequent requirement.", quoteOf("sellsEu"))
        : row("iso27001", "not_indicated", "none", "No sign it is needed yet", null, null);

  const gdpr: FrameworkRow = known("gdprStated") === true
    ? row("gdpr", "held", "stated", "States GDPR compliance", "Their own page says they comply, so the question is how they prove it.", quoteOf("gdprStated"))
    : eu
      ? row("gdpr", "likely", "inferred", "Applies: they sell into the EU", "Selling to EU customers brings GDPR duties whether or not the site mentions it.", quoteOf("sellsEu"))
      : row("gdpr", "not_indicated", "none", "No sign it applies", null, null);

  const hipaa: FrameworkRow = known("hipaaStated") === true
    ? row("hipaa", "held", "stated", "States HIPAA compliance", "Their own page says so.", quoteOf("hipaaStated"))
    : health
      ? row("hipaa", "likely", "inferred", "Applies: they handle health data", "Handling health information brings HIPAA duties in the US.", quoteOf("healthData"))
      : row("hipaa", "not_indicated", "none", "No sign it applies", null, null);

  const pci: FrameworkRow = known("pciStated") === true
    ? row("pci", "held", "stated", "States PCI DSS compliance", "Their own page says so.", quoteOf("pciStated"))
    : pay
      ? row("pci", "likely", "inferred", "Applies: they take payments", "Taking card payments brings PCI DSS duties, unless a processor carries them.", quoteOf("payments"))
      : row("pci", "not_indicated", "none", "No sign it applies", null, null);

  const frameworks = [soc2, iso, gdpr, hipaa, pci];
  const open = frameworks.filter((f) => f.status === "likely" || f.status === "in_progress");

  // What this means for the conversation.
  const bothHeld = soc2Held && isoHeld;
  const stance: Stance =
    bothHeld
      ? { headline: "Certified on both big frameworks", angle: "Not getting certified. Lead with upkeep between audits, renewal effort, the volume of customer questionnaires, and whichever framework comes next.", caution: "Do not pitch a first certification: it will sound out of touch." }
      : comp === "soc2_type2"
        ? { headline: "SOC 2 Type 2 in hand", angle: eu ? "Upkeep and the next framework: they sell into the EU, so ISO 27001 or GDPR evidence is the likely next ask." : "Upkeep between audits, and how fast they can answer the next buyer's questionnaire.", caution: "A report on the wall means the first reaction will be that they are covered. Ask what the work looks like between audits." }
        : comp === "soc2_type1"
          ? { headline: "Type 1 held, Type 2 ahead", angle: "The Type 2 window is the commitment now: months of evidence that has to keep passing.", caution: "They have proved they can pass once. The pain is staying passed." }
          : comp === "iso_only"
            ? { headline: "ISO 27001 held, no SOC 2 visible", angle: upmarket ? "US buyers will ask for SOC 2 and the ISO work can be reused for it." : "Reusing the ISO controls for a SOC 2 report if US customers appear.", caution: "Check whether US customers are in their plans before leading with SOC 2." }
            : comp === "in_progress"
              ? { headline: "Mid-certification: the pain is live", angle: "Evidence collection, audit dates and who is doing the chasing. This is the best moment to talk.", caution: "They may already have chosen a tool or a consultant. Ask early." }
              : comp === "none_visible" && upmarket
                ? { headline: "Sells upmarket with no report visible", angle: "The first customer who asks for a security report will set the clock. Find out who asked last.", caution: "They may have a report that is not on the site. Ask before assuming a gap." }
                : comp === "none_visible"
                  ? { headline: "No compliance driver visible yet", angle: "Low urgency from the site alone. Look for a trigger: a large customer, a funding round, a regulated market.", caution: "Do not push. Ask what would make this a priority and agree when to come back." }
                  : { headline: "Compliance status not visible", angle: "The site does not say where they stand, so the first job on the call is to find out.", caution: "Open with the questions, not a pitch." };

  // How far from the next verdict, and what could move it.
  const maybeAt = i.icp?.maybeAt ?? 45;
  const qualifyAt = i.icp?.qualifyAt ?? 65;
  const pts = i.icp?.points;
  const maxOf = (rec: Record<string, number> | undefined) => (rec ? Math.max(0, ...Object.values(rec)) : 0);
  const POTENTIAL: Record<string, { label: string; max: number }> = {
    headcount: { label: "Company size", max: maxOf(pts?.size) },
    securityHiring: { label: "Whether they are hiring for security or compliance", max: pts?.hiring?.security_role ?? 0 },
    compliance: { label: "Which certifications they hold", max: maxOf(pts?.status) },
    customerData: { label: "Whether they hold customers' data", max: pts?.customerData?.stated ?? 0 },
    enterprisePlan: { label: "An enterprise plan", max: pts?.enterprise?.plan ?? 0 },
    enterpriseLogos: { label: "Named enterprise customers", max: pts?.enterprise?.logos ?? 0 },
    enterpriseSecurity: { label: "Enterprise security features", max: pts?.enterprise?.security ?? 0 },
    recentLaunchOrFunding: { label: "A recent launch or funding", max: pts?.timing?.recent ?? 0 },
    securityFriction: { label: "Security-review friction", max: pts?.timing?.friction ?? 0 },
    newRegulatedMarket: { label: "A move into a regulated market", max: pts?.timing?.market ?? 0 },
  };
  const unknowns = i.missing
    .map((key) => ({ key, label: POTENTIAL[key]?.label ?? key, couldAdd: POTENTIAL[key]?.max ?? 0 }))
    .filter((u) => u.couldAdd > 0)
    .sort((a, b) => b.couldAdd - a.couldAdd);
  const score = i.score;
  const next = score === null ? null : score < maybeAt ? { label: "a possible fit, which a person can promote", points: maybeAt - score } : score < qualifyAt ? { label: "a strong fit, which carries on by itself", points: qualifyAt - score } : null;
  const couldReach = score === null ? null : Math.min(100, score + unknowns.reduce((n, u) => n + u.couldAdd, 0));
  const ruledOut = i.verdict === "not_fit";
  const path: PathToVerdict = {
    score, maybeAt, qualifyAt, next, unknowns, couldReach,
    summary:
      score === null ? "This company has not been scored yet."
      : ruledOut ? `Scored ${score}. The ICP rules this one out, so points alone will not change that.`
      : !next ? `Scored ${score}, at or above the bar for a strong fit (${qualifyAt}).`
      : unknowns.length === 0 ? `Scored ${score}: ${next.points} short of ${next.label}, and nothing the site left unsaid could add points. This is the honest result.`
      : couldReach !== null && couldReach >= (score < maybeAt ? maybeAt : qualifyAt)
        ? `Scored ${score}: ${next.points} short of ${next.label}. The site did not say ${unknowns.slice(0, 3).map((u) => u.label.toLowerCase()).join(", ")}, which could add up to ${couldReach - score} points, so one call or one lookup could settle it.`
        : `Scored ${score}: ${next.points} short of ${next.label}. Even if everything the site left unsaid came out best, it would reach ${couldReach}, so this is unlikely to qualify.`,
  };

  // The call plan.
  const trigger = i.whyNow[0] ?? null;
  const steps: PlanStep[] = [];
  if (trigger) steps.push({ title: "Open with what is happening for them", ask: trigger.quote ? `I read on your site: “${trigger.quote}”. What is behind that?` : `I noticed a sign on your site: ${trigger.text.charAt(0).toLowerCase()}${trigger.text.slice(1)}. What is behind that?`, why: `Signal: ${trigger.text}.` });
  const fwQuestion =
    comp === "in_progress" ? { ask: "Which audit date are you working towards, and what is slowest to get ready?", why: "A certification is in progress, so the work is live." }
    : soc2Held ? { ask: "Between audits, how do you keep your evidence current, and who owns that?", why: `They hold ${soc2.headline}.` }
    : comp === "none_visible" && upmarket ? { ask: "Which customer asked for a security report most recently, and what did you send them?", why: "They sell to larger customers and show no report on the site." }
    : isoHeld ? { ask: "Are customers in the US asking you for SOC 2, and how are you answering today?", why: "ISO 27001 is held but no SOC 2 is visible." }
    : { ask: "Which frameworks have customers or prospects asked for, and by when?", why: "The site does not say where they stand." };
  steps.push({ title: "Find where they stand", ...fwQuestion });
  if (eu && !(gdpr.status === "held")) steps.push({ title: "Check the EU angle", ask: "When EU customers ask about data protection or ISO 27001, what do you hand over?", why: "They sell into the EU." });
  else if (health) steps.push({ title: "Check the health-data angle", ask: "Do health customers ask for HIPAA evidence, and who answers?", why: "They handle health data." });
  else if (pay) steps.push({ title: "Check the payments angle", ask: "How do you show buyers you handle card data safely?", why: "They take payments." });
  for (const p of i.picks.slice(0, 2)) {
    const q = (QUESTIONS[p.id as PainId] ?? [])[0];
    if (q) steps.push({ title: p.label, ask: q, why: p.evidence[0]?.quotes[0] ? `Their own page: “${p.evidence[0].quotes[0]}”` : FRAMING[p.id as PainId] ?? "" });
  }
  steps.push({ title: "Learn how the decision gets made", ask: UNIVERSAL_QUESTIONS[1]!, why: "Needed to know who else to bring in." });

  const second = i.group[0] ?? null;
  const plan: CallPlan = {
    opener: i.hook?.quote ? { line: `Open with their own words: “${i.hook.quote}”`, quote: i.hook.quote, source: i.hook.source } : trigger?.quote ? { line: `Open with their own words: “${trigger.quote}”`, quote: trigger.quote, source: null } : null,
    steps: steps.slice(0, 6),
    bring: i.claims.length ? i.claims.map((c) => `${c} (verified)`) : ["No Sprinto claim has been verified yet: bring questions, not promises."],
    nextStep: second ? `Ask for 20 minutes with ${second.title ?? second.name}${second.roleLabel ? ` (${second.roleLabel})` : ""}, who feels a different part of this.` : "Ask who else should join, and book 20 minutes with them.",
    followUp: "Send a two-line recap within a day that quotes their own words back. If there is no reply in three working days, send one short nudge and then stop.",
  };

  // A competing tool, if the site shows one.
  const compete = i.usesCompetitor
    ? { quote: i.usesCompetitor.quote, play: "Do not disparage it. Ask what it covers beyond automated checks: who answers the questionnaires, how many frameworks, who owns it. Ask for outcomes, such as hours of audit preparation and days to answer a questionnaire." }
    : null;

  // Objections this company's own evidence makes likely.
  const extra: { says: string; response: string }[] = [];
  if (bothHeld || soc2Held) extra.push({ says: "We already have our certifications, so we are fine.", response: "Congratulate them, then ask what keeping them costs: renewal effort each year, evidence upkeep, and how many questionnaires still arrive. The report is the start of the work." });
  if (compete) extra.push({ says: "We already use a compliance tool.", response: "Ask what they wish it did. Do not argue. Listen for the gaps it leaves: questionnaires, a second framework, the people hours around it." });
  if (eu) extra.push({ says: "Our EU customers have not asked for anything specific.", response: "Ask what they would send if a German or French buyer asked for a data-protection or ISO 27001 report tomorrow. The answer is the gap." });
  if (open.some((f) => (f.id === "hipaa" || f.id === "pci") && !f.sprintoClaim)) extra.push({ says: "Do you cover HIPAA or PCI?", response: "Do not promise. No verified claim covers it yet. Say you will find out and come back with a straight answer." });

  // How much of the brief rests on evidence.
  const keyFacts = ["product", "audience", "customerData", "headcount", "compliance", "securityHiring"];
  const knownKey = keyFacts.filter((k) => known(k) !== null).length;
  const evidencedPicks = i.picks.length >= 2 && i.picks.every((p) => p.evidence.some((e) => e.quotes.length > 0));
  const reasons = [
    { ok: knownKey >= 5, text: `${knownKey} of ${keyFacts.length} key facts were read from the site` },
    { ok: i.pagesRead >= 3, text: `${i.pagesRead} pages were read` },
    { ok: evidencedPicks, text: evidencedPicks ? "Both pains cite the company's own words" : "The pains are missing or lack a quote" },
    { ok: Boolean(i.hook?.quote), text: i.hook?.quote ? "There is a line of their own to open with" : "No opening line was recorded" },
    { ok: Boolean(i.contact) && (i.contact?.verification === "valid" || i.contact?.checkedValid === true), text: i.contact ? (i.contact.verification === "valid" || i.contact.checkedValid ? "The contact's address is verified" : "The contact's address is not fully verified") : "No contact was found" },
  ];
  const weights = [35, 10, 20, 15, 20];
  const percent = Math.round(reasons.reduce((n, r, k) => n + (r.ok ? weights[k]! : 0), 0));
  const confidence: Confidence = { percent, label: percent >= 80 ? "Well supported" : percent >= 55 ? "Partly supported" : "Thin: ask before assuming", reasons };

  return { frameworks, stance, path, plan, confidence, compete, extraObjections: extra };
}
