/**
 * A discovery-call brief for one researched company: everything a Sprinto person needs before the call, on one page, built by
 * code from what the pipeline already recorded (the rubric's quotes, the chosen person, the two pains, the draft, the verified
 * Sprinto facts). No model is called here, so the brief can only say what the evidence shows, and every statement about the
 * company carries the quote and the page it came from. Pure, so each part is tested.
 */

import { aboutFrom } from "@/lib/discovery/peek";
import { companyName } from "@/lib/pitch/company";
import type { PainId } from "@/lib/pitch/pains";
import type { Facts } from "@/lib/icp/types";
import { buildGroup, type GroupCandidate, type GroupMember } from "./group";
import { buildIntel, type Intel, type IntelInput } from "./intel";
import { FRAMING, OBJECTIONS, QUESTIONS, SIGNAL_LABEL, UNIVERSAL_QUESTIONS } from "./library";

export interface BriefInput {
  domain: string;
  pages: { url: string; kind: string; title: string | null; text: string }[];
  lane: string;
  verdict: string | null;
  score: number | null;
  scoreReason: string | null;
  parts: { id: string; group: string; label: string; points: number; max: number; quotes: string[] }[];
  missing: string[];
  facts: Record<string, { value: unknown; confidence: string; quotes: string[]; source?: string }> | null;
  contact: { id?: string; name: string; title: string | null; email: string | null; verification: string | null; confidence: number | null; source: string; rankScore: number | null } | null;
  /** The newest paid check of the chosen address, if a person made one. It outranks what Hunter said when it found the address. */
  verified?: { status: string; score: number | null; at: string } | null;
  /** The other candidates, for the buying group. */
  others?: GroupCandidate[];
  /** The facts as stored, for matching each other person to the pain their role feels. */
  rawFacts?: Facts | null;
  candidates: number;
  picks: { id: string; label: string; plain: string; reason: string; evidence: { id: string; text: string; quotes: string[]; kind: string }[] }[];
  email: { subject: string; body: string; status: string; hookQuote: string | null; hookSource: string | null } | null;
  /** The thresholds and point values of the ICP version this company was scored under, for the path-to-verdict. */
  icp?: IntelInput["icp"];
  /** Claims about Sprinto a person has verified, and how many are still waiting. */
  claims: string[];
  unverifiedClaims: number;
}

export interface Cited {
  text: string;
  quote: string | null;
  source: string | null;
}

export interface Brief {
  company: { name: string; domain: string; about: string; size: string | null; sizeFromHunter: boolean; certification: string | null; product: string | null };
  fit: { verdict: string; label: string; score: number | null; summary: string; parts: BriefInput["parts"]; strengths: (Cited & { points: number; max: number })[]; gaps: string[]; usesCompetitor: Cited | null };
  contact: { id: string | null; name: string; title: string | null; email: string | null; trust: string; why: string; checked: { status: string; score: number | null; at: string } | null; shouldVerify: boolean } | null;
  group: GroupMember[];
  whyNow: Cited[];
  talkingPoints: { id: string; label: string; framing: string; because: string; evidence: Cited[] }[];
  questions: { pain: string | null; text: string }[];
  objections: { says: string; response: string }[];
  mayState: string[];
  email: { subject: string; body: string; status: string } | null;
  /** Where they stand on each framework, what it means for the call, the path to a stronger verdict, a call plan, and how well supported it all is. */
  intel: Intel;
  ready: { ok: boolean; checks: { label: string; ok: boolean; note: string }[] };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const FIT_LABEL: Record<string, string> = { qualified: "Strong fit", maybe: "Possible fit", not_fit: "Not a fit", needs_more: "Not enough to judge" };

export function buildBrief(i: BriefInput): Brief {
  const home = i.pages.find((p) => p.kind === "home") ?? i.pages[0];
  const name = companyName(i.domain, home?.title ?? null);
  const sourceOf = (quote: string): string | null => {
    const n = norm(quote);
    return i.pages.find((p) => norm(p.text).includes(n))?.url ?? null;
  };
  const cited = (text: string, quote: string | null | undefined): Cited => ({ text, quote: quote ?? null, source: quote ? sourceOf(quote) : null });
  const value = (k: string) => (i.facts?.[k] && i.facts[k]!.confidence !== "low" ? i.facts[k]!.value : null);

  const verdict = i.verdict ?? "needs_more";
  const strengths = [...i.parts].filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 5).map((p) => ({ ...cited(p.label, p.quotes[0]), points: p.points, max: p.max }));
  const gaps = [
    ...i.parts.filter((p) => p.points < 0).map((p) => p.label),
    ...i.missing.map((m) => `${m} was not visible on the site`),
  ];
  const cert = value("compliance");
  const size = value("headcount");
  const product = value("product");

  const fitSummary =
    i.score === null ? "This company has not been scored yet."
    : verdict === "qualified" ? `Scored ${i.score} out of 100 against the ICP, driven by ${strengths.slice(0, 3).map((s) => s.text.toLowerCase()).join(", ") || "its fit"}.`
    : verdict === "maybe" ? `Scored ${i.score} out of 100: some signals, not enough to be sure. ${i.scoreReason ?? ""}`.trim()
    : verdict === "not_fit" ? `Scored ${i.score} out of 100. ${i.scoreReason ?? "It does not meet the ICP."}`.trim()
    : `Scored ${i.score} out of 100, but key facts are still unknown. ${i.scoreReason ?? ""}`.trim();

  const v = i.verified ?? null;
  const trust = !i.contact ? "" : v ? (v.status === "valid" ? `Checked with Hunter's verifier: the address is valid${v.score !== null ? ` (${v.score}% sure)` : ""}` : v.status === "invalid" ? "Checked with Hunter's verifier: the address is invalid. Do not use it." : `Checked with Hunter's verifier: ${v.status.replace("_", " ")}, so it still cannot be vouched for`) : i.contact.source === "manual" ? "Hand-picked by a person" : i.contact.verification === "valid" ? `Hunter verified the address${i.contact.confidence ? ` (${i.contact.confidence}% sure)` : ""}` : i.contact.verification ? `Hunter could not fully verify the address (${i.contact.verification})` : "Address not verified";
  // Worth paying a credit to check: nobody has checked it properly, and Hunter's own status leaves doubt.
  const shouldVerify = Boolean(i.contact?.email) && !v && i.contact?.verification !== "valid";
  const contact = i.contact
    ? { id: i.contact.id ?? null, name: i.contact.name, title: i.contact.title, email: i.contact.email, trust, checked: v, shouldVerify, why: `${i.candidates > 1 ? `Chosen from ${i.candidates} candidates` : "The only suitable candidate"}${i.contact.rankScore !== null ? `, ranked ${i.contact.rankScore}` : ""} on title for this company's size, seniority and how sure the address is.` }
    : null;

  const whyNow: Cited[] = [
    ...i.parts.filter((p) => p.group === "timing" && p.points > 0).map((p) => cited(p.label, p.quotes[0])),
    ...(value("securityHiring") === "security_role" && !i.parts.some((p) => p.group === "timing" && /hir|role/i.test(p.label)) ? [cited("A security or compliance role is open", i.facts?.securityHiring?.quotes[0])] : []),
  ];

  const talkingPoints = i.picks.map((p) => ({
    id: p.id,
    label: p.label,
    framing: FRAMING[p.id as PainId] ?? "",
    because: p.reason,
    evidence: p.evidence.map((e) => cited(e.text, e.quotes[0])),
  }));

  const questions = [
    ...i.picks.flatMap((p) => (QUESTIONS[p.id as PainId] ?? []).map((text) => ({ pain: p.label, text }))),
    ...UNIVERSAL_QUESTIONS.map((text) => ({ pain: null, text })),
  ];

  const signalIds = new Set(i.picks.flatMap((p) => p.evidence.map((e) => e.id)));
  if (value("compliance") === "none_visible") signalIds.add("noCert");
  const objections = OBJECTIONS.filter((o) => o.when.length === 0 || o.when.some((s) => signalIds.has(s))).map(({ says, response }) => ({ says, response }));

  const checks = [
    { label: "Scored against the ICP", ok: i.score !== null, note: i.score !== null ? `${i.score} out of 100` : "Not scored yet" },
    { label: "A named person to speak to", ok: Boolean(i.contact?.name && i.contact.title), note: i.contact ? `${i.contact.name}${i.contact.title ? `, ${i.contact.title}` : ""}` : "No contact found" },
    { label: "Two pains with evidence", ok: i.picks.length >= 2 && i.picks.every((p) => p.evidence.length > 0), note: i.picks.length >= 2 ? "Each cites the company's own words" : "Pains not chosen yet" },
    { label: "Something specific to open with", ok: Boolean(i.email?.hookQuote), note: i.email?.hookQuote ? "A line from their own site" : "No hook recorded" },
    { label: "Verified facts about Sprinto to cite", ok: i.claims.length > 0, note: i.claims.length ? `${i.claims.length} verified` : "None verified yet" },
  ];

  const group = buildGroup({ candidates: i.others ?? [], facts: i.rawFacts ?? null, avoid: i.picks.map((p) => p.id) });
  const usesCompetitor = ((p) => (p ? cited(p.label, p.quotes[0]) : null))(i.parts.find((x) => /competitor/i.test(x.label) && x.points < 0));
  const intel = buildIntel({
    facts: i.facts,
    pages: i.pages,
    verdict: i.verdict,
    score: i.score,
    icp: i.icp ?? null,
    missing: i.missing,
    picks: i.picks,
    whyNow: whyNow.map((w) => ({ text: w.text, quote: w.quote })),
    hook: i.email ? { quote: i.email.hookQuote, source: i.email.hookSource } : null,
    claims: i.claims,
    group: group.map((m) => ({ title: m.title, roleLabel: m.roleLabel ?? null, name: m.name })),
    contact: i.contact ? { name: i.contact.name, title: i.contact.title, verification: i.contact.verification, checkedValid: v?.status === "valid" } : null,
    usesCompetitor: usesCompetitor ? { quote: usesCompetitor.quote } : null,
    pagesRead: i.pages.length,
  });
  // The objections this company's own evidence makes likely come first, then the general ones, without repeats.
  const mergedObjections = [...intel.extraObjections, ...objections].filter((o, k, all) => all.findIndex((x) => x.says === o.says) === k).slice(0, 8);

  return {
    company: { name, domain: i.domain, about: home ? aboutFrom(home.text, home.title ?? "") : "", size: size ? String(size) : null, sizeFromHunter: Boolean(size) && i.facts?.headcount?.source === "hunter_discover", certification: cert ? (SIGNAL_LABEL[String(cert)] ?? String(cert)) : null, product: product ? String(product) : null },
    fit: { verdict, label: FIT_LABEL[verdict] ?? "Not assessed", score: i.score, summary: fitSummary, parts: i.parts, strengths, gaps, usesCompetitor },
    contact,
    group,
    whyNow,
    talkingPoints,
    questions,
    objections: mergedObjections,
    mayState: i.claims,
    email: i.email ? { subject: i.email.subject, body: i.email.body, status: i.email.status } : null,
    intel,
    ready: { ok: checks.every((c) => c.ok), checks },
  };
}

/** The brief as plain text, for pasting into a calendar invite, a CRM note or a chat. */
export function briefToText(b: Brief): string {
  const out: string[] = [];
  const h = (t: string) => out.push("", t.toUpperCase());
  out.push(`DISCOVERY CALL BRIEF: ${b.company.name} (${b.company.domain})`);
  if (b.company.about) out.push(`They say: "${b.company.about}"`);
  out.push(`Fit: ${b.fit.label}${b.fit.score !== null ? ` (${b.fit.score}/100)` : ""}. ${b.fit.summary}`);
  if (b.fit.usesCompetitor) out.push(`Caution: they already seem to use a competitor${b.fit.usesCompetitor.quote ? ` ("${b.fit.usesCompetitor.quote}")` : ""}.`);
  const facts = [b.company.size ? `${b.company.size} people${b.company.sizeFromHunter ? " (per Hunter)" : ""}` : null, b.company.certification].filter(Boolean);
  if (facts.length) out.push(facts.join(" · "));
  h("Where they stand");
  out.push(`${b.intel.stance.headline}. ${b.intel.stance.angle}`, `Careful: ${b.intel.stance.caution}`);
  for (const f of b.intel.frameworks.filter((x) => x.status !== "not_indicated")) out.push(`- ${f.name}: ${f.headline}${f.basis === "inferred" ? " (our inference)" : ""}${f.quote ? ` ("${f.quote}")` : ""}${f.sprintoClaim ? "" : " [no verified Sprinto claim: do not promise]"}`);
  out.push(`Path: ${b.intel.path.summary}`);
  out.push(`Evidence: ${b.intel.confidence.percent}% (${b.intel.confidence.label}).`);
  if (b.contact) {
    h("Who to speak to");
    out.push(`${b.contact.name}${b.contact.title ? `, ${b.contact.title}` : ""}${b.contact.email ? ` <${b.contact.email}>` : ""}`, b.contact.trust, b.contact.why);
  }
  if (b.group.length) {
    h("Also worth speaking to");
    for (const m of b.group) out.push(`- ${m.name}${m.title ? `, ${m.title}` : ""}${m.email ? ` <${m.email}>` : ""}`, ...(m.angle ? [`  Lead with: ${m.angle.label}. ${m.angle.framing}`] : []), `  ${m.why}`);
  }
  if (b.whyNow.length) {
    h("Why now");
    for (const w of b.whyNow) out.push(`- ${w.text}${w.quote ? ` ("${w.quote}")` : ""}`);
  }
  if (b.talkingPoints.length) {
    h("Talking points");
    for (const t of b.talkingPoints) {
      out.push(`- ${t.label}`, `  ${t.framing}`);
      for (const e of t.evidence) out.push(`  Evidence: ${e.text}${e.quote ? ` ("${e.quote}")` : ""}${e.source ? ` ${e.source}` : ""}`);
    }
  }
  h("Call plan");
  if (b.intel.plan.opener) out.push(b.intel.plan.opener.line);
  b.intel.plan.steps.forEach((st, k) => out.push(`${k + 1}. ${st.title}: ${st.ask}`));
  out.push(`Bring: ${b.intel.plan.bring.join("; ")}`, `Next step: ${b.intel.plan.nextStep}`, `After: ${b.intel.plan.followUp}`);
  h("More questions to ask");
  for (const q of b.questions) out.push(`- ${q.text}`);
  if (b.objections.length) {
    h("If they say");
    for (const o of b.objections) out.push(`- "${o.says}" ${o.response}`);
  }
  if (b.mayState.length) {
    h("What you may say about Sprinto (verified)");
    for (const c of b.mayState) out.push(`- ${c}`);
  }
  if (b.fit.gaps.length) {
    h("Not known");
    for (const g of b.fit.gaps) out.push(`- ${g}`);
  }
  return out.join("\n");
}
