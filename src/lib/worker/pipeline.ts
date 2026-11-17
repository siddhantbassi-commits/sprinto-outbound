import { qualify } from "@/lib/agent/loop";
import { TokenBudget } from "@/lib/ai/budget";
import type { AiClient } from "@/lib/ai/types";
import { chooseContact, classifyTitle } from "@/lib/contacts/rank";
import { findCandidates } from "@/lib/contacts/find";
import type { HunterClient } from "@/lib/contacts/hunter";
import { HunterBudget } from "@/lib/contacts/quota";
import type { GmailSender } from "@/lib/email/gmail";
import { buildInboxHeader, composeTestBody } from "@/lib/email/inbox-header";
import { isExcludedDomain } from "@/lib/icp/blocklist";
import { use } from "@/lib/icp/score";
import type { Band } from "@/lib/icp/types";
import { choosePains } from "@/lib/pitch/choose-pains";
import { companyName } from "@/lib/pitch/company";
import { composeBody, draftEmail } from "@/lib/pitch/draft";
import { allQuotes, hookOptions } from "@/lib/pitch/hooks";
import { shortlist } from "@/lib/pitch/pains";
import { optOutFooter, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import { createSite } from "@/lib/scrape/site";
import type { FetchDeps } from "@/lib/scrape/fetch";
import { normaliseDomain } from "@/lib/scrape/url-guard";
import type { ProspectRow, Settings, Store } from "./store";
import type { Row } from "@/lib/db/port";

/**
 * The seven steps as handlers. Each reads what earlier steps stored, does one piece of work, stores what it produced,
 * and says what should happen to the prospect: move on, be parked with a reason, or (for the send) already settled.
 * A handler never touches another prospect and never talks to the database except through the store.
 */

export interface PipelineDeps {
  store: Store;
  ai: AiClient;
  fetchDeps: FetchDeps;
  hunter: HunterClient | null;
  gmail: GmailSender | null;
  /** Where the Why page lives, for the link in the inbox header. */
  appUrl: string | null;
  now: () => number;
  /** How long one step may run before it stops starting new work. */
  stepBudgetMs: number;
}

export type StepResult =
  | { kind: "advance"; output?: Row; model?: string; promptVersion?: string; tokens?: number }
  | { kind: "park"; lane: string; reason: string; output?: Row; model?: string; promptVersion?: string; tokens?: number }
  | { kind: "done" };

/** A failure that is worth trying again after a wait: a site that timed out, a model that was overloaded. */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

const advance = (output?: Row, extra: Partial<Extract<StepResult, { kind: "advance" }>> = {}): StepResult => ({ kind: "advance", output, ...extra });
const park = (lane: string, reason: string, output?: Row, extra: Partial<Extract<StepResult, { kind: "park" }>> = {}): StepResult => ({ kind: "park", lane, reason, output, ...extra });

const NO_HUNTER: HunterClient = {
  account: async () => {
    throw new Error("Hunter is not configured");
  },
  domainSearch: async () => {
    throw new Error("Hunter is not configured");
  },
};

async function budgetsFor(store: Store, settings: Settings, runId: string) {
  const run = new TokenBudget(settings.tokens_per_run);
  const used = await store.runTokens(runId);
  run.charge({ promptTokens: 0, outputTokens: 0, totalTokens: used });
  return { run, domain: new TokenBudget(settings.tokens_per_domain, run) };
}

// ---------------------------------------------------------------- 1. scrape
export async function scrape(p: ProspectRow, d: PipelineDeps): Promise<StepResult> {
  const checked = normaliseDomain(p.domain);
  if (!checked.ok || checked.domain !== p.domain) return park("skipped", `Not a valid public domain: ${checked.ok ? "not in normal form" : checked.reason}`);

  const site = createSite(p.domain, d.fetchDeps);
  await site.crawl();
  const pages = site.pages();
  if (pages.length === 0) {
    const reasons = site.skipped().map((s) => s.reason);
    const first = reasons[0] ?? "No page could be read";
    if (reasons.some((r) => r.startsWith("Refused:"))) return park("skipped", `The site was refused: ${first}`);
    if (reasons.some((r) => /timed? ?out|No full response|connect|closed|HTTP 5\d\d/i.test(r))) throw new TransientError(`The site could not be reached: ${first}`);
    return park("needs_more", `The site could not be read: ${first}`, { skipped: site.skipped().slice(0, 10) });
  }
  await d.store.insertPages(p.id, pages);
  return advance({ pages: pages.length, thin: pages.filter((x) => x.thin).length, discovered: site.discovered().slice(0, 200), skipped: site.skipped().slice(0, 10) });
}

// ---------------------------------------------------------------- 2+3. extract and qualify
const TRANSIENT_AI = new Set(["timeout", "rate_limited", "overloaded", "api_error", "bad_json", "empty"]);

export async function qualifyStep(p: ProspectRow, d: PipelineDeps): Promise<StepResult> {
  const settings = await d.store.settings();
  const icp = await d.store.icpForRun(p.run_id);
  const stored = await d.store.pages(p.id);
  const site = createSite(p.domain, d.fetchDeps);
  site.preload(stored, await d.store.discovered(p.id));
  const budgets = await budgetsFor(d.store, settings, p.run_id);
  const known = new Set(stored.map((x) => x.url));

  const r = await qualify({
    ai: d.ai,
    site,
    budget: budgets.domain,
    context: { excludedDomain: isExcludedDomain(p.domain, icp.blocklist), suppressed: await d.store.isSuppressed("domain", p.domain) },
    cfg: icp.config,
    deadline: d.now() + d.stepBudgetMs,
    now: d.now,
  });

  // A model that was down or slow is not a verdict. Wait and try again; never score what was not read.
  if (r.passes.length === 0 && r.failure && TRANSIENT_AI.has(r.failure.code)) throw new TransientError(`The model could not read this company yet: ${r.failure.reason}`);
  if (r.passes.length === 0 && (r.failure?.code === "auth" || r.failure?.code === "billing" || r.failure?.code === "not_configured")) throw new Error(r.failure.reason);

  await d.store.insertPages(p.id, site.pages().filter((x) => !known.has(x.url)));
  await d.store.insertFacts(
    p.id,
    r.passes.map((x) => ({ facts: x.facts, grounding: x.grounding, absences: x.absences, injection: x.injection, problems: x.problems, model: x.model, promptVersion: x.promptVersion, truncated: x.truncated })),
  );
  await d.store.insertScore(p.id, icp.id, r.score);
  await d.store.usage(p.run_id, p.id, "gemini_tokens", r.usage.totalTokens, r.extraction?.model);

  const output: Row = {
    verdict: r.score.verdict,
    score: r.score.score,
    missing: r.score.missing,
    flags: r.score.flags,
    // What the reading-enough gate saw, so a replay under a different ICP can apply the same gate to the same amount of text.
    text_chars: site.pages().reduce((n, x) => n + x.text.length, 0),
    pages: site.pages().length,
    rounds: r.rounds,
    stopped_because: r.stoppedBecause,
    trace: r.trace,
    grounding_failures: r.passes.flatMap((x) => x.grounding.failures),
    injection: r.passes.flatMap((x) => x.injection.map((i) => ({ url: i.url, rules: i.scan.matches.map((m) => m.rule) }))),
  };
  const meta = { model: r.extraction?.model, promptVersion: r.extraction?.promptVersion, tokens: r.usage.totalTokens };

  switch (r.score.verdict) {
    case "qualified":
      return advance(output, meta);
    case "maybe":
      return park("review", `Maybe (${Math.round(r.score.score)}/100): ${r.score.reason.replace(/[.\s]+$/, "")}. A person decides whether to promote it.`, output, meta);
    case "not_fit":
      return park("not_fit", r.score.reason, output, meta);
    default:
      return park("needs_more", `Not enough to judge${r.score.missing.length ? `; still unknown: ${r.score.missing.join(", ")}` : ""}.`, output, meta);
  }
}

// ---------------------------------------------------------------- 4. contact
export async function contactStep(p: ProspectRow, d: PipelineDeps): Promise<StepResult> {
  const settings = await d.store.settings();
  const manual = await d.store.manualContacts(p.domain);
  if (manual.length === 0 && !d.hunter) return park("review", "Hunter is not set up and there is no hand-picked contact for this domain. Add one to continue.");

  const hunter = d.hunter ?? NO_HUNTER;
  const found = await findCandidates(p.domain, manual, { hunter, budget: new HunterBudget(hunter, { reserve: settings.hunter_reserve, now: d.now }), cache: d.store.contactCache(), now: d.now });
  await d.store.usage(p.run_id, p.id, "hunter_credits", found.creditsSpent);

  if (found.candidates.length === 0) {
    if (found.reason === "hunter_error") throw new TransientError(found.detail);
    if (found.reason === "budget" || found.reason === "quota_exhausted") return park("review", `${found.detail} Add a hand-picked contact, or wait for credits to renew.`, { source: found.source, detail: found.detail });
    return park("no_contact", found.detail, { source: found.source, detail: found.detail });
  }

  const facts = await d.store.latestFacts(p.id);
  const band = (facts ? use(facts.headcount) : null) as Band | null;
  const choice = chooseContact(found.candidates, band);
  const rows = [...choice.ranked, ...choice.excluded].map((r) => ({
    source: r.candidate.source,
    first_name: r.candidate.firstName,
    last_name: r.candidate.lastName,
    position: r.candidate.position,
    email: r.candidate.email,
    type: r.candidate.type,
    seniority: r.candidate.seniority,
    department: r.candidate.department,
    confidence: r.candidate.confidence === null ? null : Math.round(r.candidate.confidence),
    verification: r.candidate.verification,
    rank_score: Math.round(r.score),
    rank_parts: r.parts,
    excluded: r.excluded,
    chosen: choice.chosen === r,
  }));
  await d.store.insertContacts(p.id, rows);

  // Names and addresses stay out of the trace; the contacts table holds them, and retention can blank them.
  const output: Row = {
    source: found.source,
    detail: found.detail,
    candidates: found.candidates.length,
    excluded: choice.excluded.length,
    chosen_role: choice.chosen?.role ?? null,
    chosen_score: choice.chosen?.score ?? null,
    runner_up_score: choice.runnerUp?.score ?? null,
    chosen_parts: choice.chosen?.parts ?? [],
    band,
  };
  if (!choice.chosen) return park("no_contact", `${found.candidates.length} candidate(s), none suitable (${choice.excluded.map((e) => e.excluded).slice(0, 3).join("; ")}).`, output);
  return advance(output);
}

// ---------------------------------------------------------------- 5. pains
export async function painsStep(p: ProspectRow, d: PipelineDeps): Promise<StepResult> {
  const settings = await d.store.settings();
  const facts = await d.store.latestFacts(p.id);
  const chosen = (await d.store.contacts(p.id)).find((c) => c.chosen);
  if (!facts || !chosen) return park("held", "The facts or the chosen contact are missing, so the pains cannot be chosen.");
  if (!chosen.first_name) return park("held", "The contact's name has been removed by the retention rule, so no email can be written.");

  const pages = await d.store.pages(p.id);
  const role = classifyTitle(chosen.position);
  const sl = shortlist(facts, role);
  const budgets = await budgetsFor(d.store, settings, p.run_id);
  const choice = await choosePains({
    ai: d.ai,
    budget: budgets.domain,
    shortlist: sl,
    contact: { firstName: chosen.first_name, title: chosen.position, role },
    company: { name: companyName(p.domain, pages.find((x) => x.kind === "home")?.title ?? null), domain: p.domain },
    timeoutMs: Math.min(30_000, d.stepBudgetMs),
  });
  await d.store.usage(p.run_id, p.id, "gemini_tokens", choice.usage.totalTokens, choice.model);

  return advance(
    {
      source: choice.source,
      fallback_reason: choice.fallbackReason ?? null,
      thin_evidence: sl.thinEvidence,
      shortlist: sl.items.map((s) => ({ id: s.pain.id, score: s.score, signal_points: s.signalPoints, persona_points: s.personaPoints })),
      picks: choice.picks,
    },
    { model: choice.model, promptVersion: choice.promptVersion, tokens: choice.usage.totalTokens },
  );
}

// ---------------------------------------------------------------- 6. draft
export function withSettings(file: SprintoFactsFile, s: Pick<Settings, "sender_name" | "sender_title" | "postal_address">): SprintoFactsFile {
  // The sender and the postal address are settings, versioned and signed by an admin, not part of the claims file.
  return { ...file, sender: { name: s.sender_name, title: s.sender_title }, postalAddress: s.postal_address };
}

export async function draftStep(p: ProspectRow, d: PipelineDeps): Promise<StepResult> {
  const settings = await d.store.settings();
  const facts = await d.store.latestFacts(p.id);
  const chosen = (await d.store.contacts(p.id)).find((c) => c.chosen);
  const pains = await d.store.painPicks(p.id);
  if (!facts || !chosen || !pains) return park("held", "Something the draft needs (facts, contact or pains) is missing.");
  if (!chosen.first_name) return park("held", "The contact's name has been removed by the retention rule, so no email can be written.");

  const pages = await d.store.pages(p.id);
  const preferred = pains.picks.flatMap((x) => x.evidence.flatMap((e) => e.quotes));
  const hooks = hookOptions(facts, pages, preferred);
  const budgets = await budgetsFor(d.store, settings, p.run_id);
  const company = { name: companyName(p.domain, pages.find((x) => x.kind === "home")?.title ?? null), domain: p.domain };
  const file = withSettings(await d.store.factsFile(), settings);

  const res = await draftEmail({
    ai: d.ai,
    budget: budgets.domain,
    contact: { firstName: chosen.first_name, title: chosen.position },
    company,
    picks: pains.picks,
    hooks,
    evidenceQuotes: allQuotes(facts),
    facts: file,
    timeoutMs: Math.min(30_000, d.stepBudgetMs),
  });
  await d.store.usage(p.run_id, p.id, "gemini_tokens", res.usage.totalTokens, res.model);
  const meta = { model: res.model, promptVersion: res.promptVersion, tokens: res.usage.totalTokens };
  const attempts = res.attempts.map((a) => ({ n: a.n, failed: a.failed.map((f) => f.id), hook: a.hookId }));

  if (res.status === "ok") {
    await d.store.insertEmail(p.id, { subject: res.subject, body: res.body, lint: res.checks, hook: { id: res.hook.id, quote: res.hook.quote, source: res.hook.source }, picks: pains.picks, status: "drafted" });
    return advance({ attempts, hook: res.hook.id, hook_source: res.hook.source, lint_passed: res.checks.length }, meta);
  }

  // Held: keep the last attempt so a person can read it, and say exactly why it was stopped.
  const last = res.attempts.at(-1);
  if (last) {
    await d.store.insertEmail(p.id, {
      subject: last.subject || "(no subject)",
      body: composeBody({ firstName: chosen.first_name, message: last.message, sender: file.sender, footer: optOutFooter(file) }),
      lint: res.checks,
      hook: null,
      picks: pains.picks,
      status: "held",
    });
  }
  return park("held", res.reason, { attempts }, meta);
}

// ---------------------------------------------------------------- 7. send (test mode)
export async function sendStep(p: ProspectRow, d: PipelineDeps): Promise<StepResult> {
  const email = await d.store.sendableEmail(p.id);
  if (!email) return park("held", "There is no sendable draft for this prospect.");
  const settings = await d.store.settings();

  // The human boundary: with approval required, a draft waits for a person, and the wording that is sent is theirs.
  let text = { subject: email.subject, body: email.body };
  if (settings.require_approval !== false) {
    const review = await d.store.reviewFor(email.id);
    if (!review) return park("review", "Draft ready for your approval.", { awaiting: "approval" });
    if (review.action !== "approve") return park("skipped", "This draft was rejected at review.");
    text = { subject: review.subject, body: review.body };
  }

  if (!d.gmail) return park("review", "Gmail is not set up, so nothing can be sent.");
  if (!settings.test_to || settings.test_to.toLowerCase() !== d.gmail.recipient.toLowerCase()) {
    return park("held", "The test address in settings does not match the server's own test address, so nothing was sent.");
  }

  const reserved = await d.store.reserveSend(email.id);
  if (!reserved.ok) {
    const why: Record<string, [string, string]> = {
      cap_reached: ["review", "The daily send cap has been reached. A person can promote it tomorrow."],
      domain_recently_mailed: ["skipped", "This domain was mailed recently."],
      suppressed: ["skipped", "This domain or contact is on the do-not-contact list."],
      test_mode_unset: ["held", "Test mode has no address set."],
      too_many_attempts: ["failed", "Sending failed three times."],
    };
    const [lane, reason] = why[reserved.reason] ?? ["held", `The send was refused (${reserved.reason}).`];
    return park(lane, reason, { refused: reserved.reason });
  }
  if (reserved.test_to.toLowerCase() !== d.gmail.recipient.toLowerCase()) {
    await d.store.setEmailStatus(email.id, "failed", { error: "The test address changed between the check and the reservation", retryable: false });
    return { kind: "done" };
  }

  // From here the send may be under way. Whatever happens, the outcome is recorded; a crash is swept into 'unknown'.
  try {
    const contacts = await d.store.contacts(p.id);
    const chosen = contacts.find((c) => c.chosen);
    const runnerUp = contacts.filter((c) => !c.chosen && c.excluded === null).sort((a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0))[0];
    const score = await d.store.latestScore(p.id);
    const pages = await d.store.pages(p.id);
    const name = companyName(p.domain, pages.find((x) => x.kind === "home")?.title ?? null);
    const header = buildInboxHeader({
      contactName: [chosen?.first_name, chosen?.last_name].filter(Boolean).join(" ") || "(name removed)",
      contactTitle: chosen?.position ?? null,
      contactEmail: chosen?.email ?? null,
      company: name,
      domain: p.domain,
      emailVerification: chosen?.verification ?? null,
      emailConfidence: chosen?.confidence ?? null,
      verdict: p.verdict ?? score?.verdict ?? "unknown",
      score: p.score ?? score?.score ?? 0,
      reasons: (score?.parts ?? []).filter((x) => x.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((x) => ({ label: x.label, quote: x.quotes?.[0] ?? null })),
      chosenScore: chosen?.rank_score ?? 0,
      runnerUp: runnerUp ? { name: [runnerUp.first_name, runnerUp.last_name].filter(Boolean).join(" ") || "(name removed)", title: runnerUp.position, score: runnerUp.rank_score ?? 0 } : null,
      pains: email.picks.map((x) => ({ id: x.id, label: x.label })),
      hookSource: email.hook?.source ?? null,
      traceUrl: d.appUrl ? `${d.appUrl.replace(/\/+$/, "")}/prospects/${p.id}` : null,
    });

    const out = await d.gmail.sendTest({ subject: text.subject, body: composeTestBody(header, text.body), runId: email.id });
    if (out.status === "sent") await d.store.setEmailStatus(email.id, "sent", { messageId: out.messageId, threadId: out.threadId });
    else if (out.status === "failed") await d.store.setEmailStatus(email.id, "failed", { error: out.reason, retryable: out.retryable });
    else await d.store.setEmailStatus(email.id, "unknown", { error: out.reason });
  } catch (e) {
    // Building the message failed before anything left, or recording the outcome failed after it. Either way, do not guess.
    await d.store.setEmailStatus(email.id, "unknown", { error: `The send step stopped unexpectedly: ${(e as Error).message}`.slice(0, 400) }).catch(() => undefined);
  }
  return { kind: "done" };
}

export const HANDLERS = {
  queued: scrape,
  scraped: qualifyStep,
  qualified: contactStep,
  contact_found: painsStep,
  pains_chosen: draftStep,
  drafted: sendStep,
} as const;

