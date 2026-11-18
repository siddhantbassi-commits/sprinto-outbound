import { TokenBudget, estimateTokens } from "@/lib/ai/budget";
import { AiError } from "@/lib/ai/errors";
import { NO_USAGE, addUsage, type AiClient, type JsonSchema, type Usage } from "@/lib/ai/types";
import { UNTRUSTED_NOTICE, newDelimiter, wrapUntrusted } from "@/lib/ai/untrusted";
import { lintEmail, type LintCheck } from "@/lib/email/lint";
import type { HookOption } from "./hooks";
import type { PainPick } from "./choose-pains";
import { allowedNumbersFor, factsFileProblems, optOutFooter, verifiedClaims, type SprintoFactsFile } from "./sprinto-facts";

/**
 * Step 6. Code owns everything that must be exact (the greeting, the sign-off, the opt-out footer and address) and the
 * model writes only the middle: hook, pain bridge, proof, ask. The 12 lint checks decide whether the result may go;
 * a failing draft goes back for at most two repairs and is then held, with the reasons, rather than sent.
 */

export const DRAFT_PROMPT_VERSION = "draft-v2";
export const MAX_REPAIRS = 2;
/** Room for the answer plus the model's own thinking, which counts against it. A tight number cuts the answer off mid-sentence. */
const MAX_OUTPUT_TOKENS = 2048;

export const LINT_RULES_PLAIN = [
  "The whole email (greeting and sign-off included) is 60 to 130 words. The subject is at most 60 characters, not all capitals, and not a fake Re: or Fwd:.",
  "Mention the company by name.",
  "Open from the chosen hook: reuse at least two of the hook quote's own words.",
  "Ask exactly one question, and make it the last sentence before the sign-off. No other question marks.",
  "No links, emoji or exclamation marks.",
  "Use no figures except 15 (the length of the call), the digits in SOC 2 and ISO 27001, figures inside the hook quote, and figures that appear in the Sprinto facts you are given.",
  "Never claim a source we did not use: no LinkedIn, podcasts, webinars, talks or posts unless the hook quote says so.",
  "Avoid stock phrases: hope this finds you well, I came across, touching base, circling back, reach out, game-changer, best-in-class, guarantee.",
];

export interface DraftContact {
  firstName: string;
  title: string | null;
}

export interface DraftInput {
  ai: AiClient;
  budget: TokenBudget;
  contact: DraftContact;
  company: { name: string; domain: string };
  picks: PainPick[];
  hooks: HookOption[];
  /** Every verified quote for the company, for the lint's source check. */
  evidenceQuotes: string[];
  facts: SprintoFactsFile;
  timeoutMs?: number;
}

export interface DraftAttempt {
  n: number;
  subject: string;
  message: string;
  hookId: string | null;
  failed: { id: string; message: string }[];
}

interface DraftCommon {
  attempts: DraftAttempt[];
  usage: Usage;
  aiCalls: number;
  model?: string;
  promptVersion: string;
}

export type DraftResult =
  | (DraftCommon & { status: "ok"; subject: string; body: string; hook: HookOption; checks: LintCheck[] })
  | (DraftCommon & { status: "held"; reason: string; checks: LintCheck[] });

export function draftSchema(hookIds: string[]): JsonSchema {
  return {
    type: "object",
    properties: {
      subject: { type: "string" },
      message: { type: "string", description: "The middle of the email only: no greeting, no sign-off, no opt-out line." },
      hookId: { type: "string", enum: hookIds },
    },
    required: ["subject", "message", "hookId"],
  };
}

export function draftSystemPrompt(): string {
  return [
    "You write the middle of ONE short, plain-text cold email from a Sprinto growth lead to one named person. It must read like a person wrote it for them: specific, calm, no hype.",
    "",
    "You are given: the person's first name and title, the company, one hook to choose from (verified text from the company's own site), two likely pains, and the only facts you may state about Sprinto.",
    "",
    "Write four short pieces in two or three paragraphs, with no headings:",
    "1. The hook: one sentence about something real on their site, built on the hook you choose.",
    "2. The bridge: one or two sentences naming the two pains in the person's own language.",
    "3. The proof: one sentence using ONLY a Sprinto fact from the list. Nothing else counts as proof. Never state any other claim about Sprinto.",
    "4. The ask: one small question about a 15-minute call, last.",
    "",
    "Do not write a greeting, a sign-off, the sender's name or any opt-out line: those are added for you.",
    "",
    "Hard rules (each is checked by code):",
    ...LINT_RULES_PLAIN.map((r, i) => `${i + 1}. ${r}`),
    "",
    UNTRUSTED_NOTICE,
  ].join("\n");
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function draftUserPrompt(input: Pick<DraftInput, "contact" | "company" | "picks" | "hooks" | "facts">, token: string, previous?: { attempt: DraftAttempt }): string {
  const { contact, company, picks, hooks, facts } = input;
  const parts = [
    `Person: ${wrapUntrusted("contact", `First name: ${clean(contact.firstName, 40)}\nTitle: ${clean(contact.title ?? "unknown", 80)}`, token)}`,
    `Company: ${clean(company.name, 80)} (${clean(company.domain, 80)})`,
    "",
    "Hooks (choose one by id; the quote is text from their site):",
    ...hooks.map((h) => `${h.id}: ${wrapUntrusted("quote", h.quote, token)}`),
    "",
    "Two likely pains:",
    ...picks.map((p) => `${p.id}. ${p.plain} (why: ${wrapUntrusted("note", p.reason, token)})`),
    "",
    "The only facts you may state about Sprinto:",
    ...verifiedClaims(facts).map((i) => `- ${i.claim}`),
  ];
  if (previous) {
    parts.push("", "Your previous draft failed these checks. Fix every one and return the full JSON again.", ...previous.attempt.failed.map((f) => `- ${f.id}: ${f.message}`), `Previous message: ${wrapUntrusted("previous", previous.attempt.message, token)}`);
  }
  return parts.join("\n");
}

/** The model may not add a greeting; if it did anyway, drop it so code's greeting is the only one. */
const stripGreeting = (s: string) => s.trim().replace(/^(hi|hello|hey|dear)\b[^\n]*,?\s*\n+/i, "");

export function composeBody(p: { firstName: string; message: string; sender: { name: string; title: string }; footer: string }): string {
  return `Hi ${p.firstName},\n\n${stripGreeting(p.message).replace(/\r\n?/g, "\n").trim()}\n\n${p.sender.name}\n${p.sender.title}, Sprinto\n\n${p.footer}`;
}

/** A first name that is safe to put in a greeting and a prompt: letters, with an apostrophe, hyphen, dot or space. */
export const isUsableFirstName = (s: string) => /^[\p{L}][\p{L}'’. -]{0,39}$/u.test(s.trim()) && !/[0-9@]/.test(s);

const held = (reason: string, c: DraftCommon, checks: LintCheck[] = []): DraftResult => ({ status: "held", reason, checks, ...c });

export async function draftEmail(input: DraftInput): Promise<DraftResult> {
  const { ai, budget, contact, company, picks, hooks, facts } = input;
  const common: DraftCommon = { attempts: [], usage: NO_USAGE, aiCalls: 0, promptVersion: DRAFT_PROMPT_VERSION };

  const problems = factsFileProblems(facts);
  if (problems.length) return held(`The Sprinto facts file is not ready. ${problems.join(" ")}`, common);
  if (!isUsableFirstName(contact.firstName)) return held("The contact's first name is missing or does not look like a name.", common);
  if (hooks.length === 0) return held("There is no verified quote on the site to open the email with.", common);
  if (picks.length < 2) return held("Two pains were not chosen.", common);

  const system = draftSystemPrompt();
  const token = newDelimiter();
  const footer = optOutFooter(facts);
  const schema = draftSchema(hooks.map((h) => h.id));
  const byId = new Map(hooks.map((h) => [h.id, h]));

  let previous: { attempt: DraftAttempt } | undefined;
  let lastChecks: LintCheck[] = [];
  let aiRetried = false;

  for (let repair = 0; repair <= MAX_REPAIRS; ) {
    const user = draftUserPrompt(input, token, previous);
    try {
      budget.assertRoom(estimateTokens(system) + estimateTokens(user) + MAX_OUTPUT_TOKENS);
    } catch {
      return held("The token budget for this domain was used up before a draft could pass.", common, lastChecks);
    }

    let data: unknown;
    try {
      common.aiCalls += 1;
      const res = await ai.generateJson({ purpose: "draft", system, user, schema, temperature: 0.6, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: input.timeoutMs ?? 30_000 });
      common.usage = addUsage(common.usage, res.usage);
      common.model = res.model;
      budget.charge(res.usage);
      data = res.data;
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("api_error");
      if (err.retryable && !aiRetried) {
        aiRetried = true;
        continue;
      }
      return held(`The model could not write a draft: ${err.message}`, common, lastChecks);
    }

    const o = data as { subject?: unknown; message?: unknown; hookId?: unknown } | null;
    const subject = typeof o?.subject === "string" ? o.subject.trim() : "";
    const message = typeof o?.message === "string" ? o.message : "";
    const hookId = typeof o?.hookId === "string" && byId.has(o.hookId) ? o.hookId : null;
    const hook = hookId ? byId.get(hookId) : undefined;
    const body = composeBody({ firstName: contact.firstName.trim(), message, sender: facts.sender, footer });

    const lint = lintEmail({
      subject,
      body,
      firstName: contact.firstName.trim(),
      company: company.name,
      hookQuote: hook?.quote ?? null,
      evidenceQuotes: input.evidenceQuotes,
      allowedNumbers: allowedNumbersFor(facts),
      postalAddress: facts.postalAddress.trim(),
    });
    lastChecks = lint.checks;
    const failed = lint.checks.filter((c) => !c.pass).map((c) => ({ id: c.id, message: c.message }));
    if (!hook) failed.push({ id: "L4", message: "Choose one of the listed hook ids." });
    const attempt: DraftAttempt = { n: common.attempts.length + 1, subject, message, hookId, failed };
    common.attempts.push(attempt);

    if (failed.length === 0 && hook && lint.ok) return { status: "ok", subject, body, hook, checks: lint.checks, ...common };
    previous = { attempt };
    repair += 1;
  }
  const last = common.attempts.at(-1);
  return held(`The draft still failed ${last?.failed.map((f) => f.id).join(", ") ?? "the checks"} after ${MAX_REPAIRS} repairs.`, common, lastChecks);
}
