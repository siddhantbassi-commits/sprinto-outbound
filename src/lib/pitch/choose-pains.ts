import { TokenBudget, estimateTokens } from "@/lib/ai/budget";
import { AiError } from "@/lib/ai/errors";
import { NO_USAGE, addUsage, type AiClient, type JsonSchema, type Usage } from "@/lib/ai/types";
import { UNTRUSTED_NOTICE, newDelimiter, wrapUntrusted } from "@/lib/ai/untrusted";
import type { Role } from "@/lib/contacts/rank";
import type { Evidence, PainId, ScoredPain, Shortlist } from "./pains";

/**
 * Step 5. Code shortlists four pains; Gemini picks the best two for this person at this company and says why in one
 * sentence each, citing evidence ids. Code checks every id. If the model fails or returns anything invalid, the code's
 * top two are used and the Why page says so. The model can never add a pain.
 */

export const PAINS_PROMPT_VERSION = "pains-v1";
const MAX_REASON_CHARS = 300;
/** Room for the answer plus the model's own thinking, which counts against it. A tight number cuts the answer off mid-sentence. */
const MAX_OUTPUT_TOKENS = 2048;

export interface PainPick {
  id: PainId;
  label: string;
  plain: string;
  /** One sentence for the trace. Written by the model, or by code on the fallback path. */
  reason: string;
  evidence: Evidence[];
}

export interface PainChoice {
  source: "model" | "code_fallback";
  picks: PainPick[];
  shortlist: Shortlist;
  /** Why the model's answer was not used, when source is code_fallback. */
  fallbackReason?: string;
  usage: Usage;
  model?: string;
  promptVersion: string;
}

export interface ChooseInput {
  ai: AiClient;
  budget: TokenBudget;
  shortlist: Shortlist;
  /** First name and title only. The address never reaches the model. */
  contact: { firstName: string; title: string | null; role: Role | null };
  company: { name: string; domain: string };
  timeoutMs?: number;
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function painsSchema(ids: PainId[]): JsonSchema {
  return {
    type: "object",
    properties: {
      picks: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: {
          type: "object",
          properties: {
            painId: { type: "string", enum: ids },
            reason: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" } },
          },
          required: ["painId", "reason", "evidenceIds"],
        },
      },
    },
    required: ["picks"],
  };
}

export function painsSystemPrompt(): string {
  return [
    "You choose the two pain points most likely to matter to ONE person at ONE company, from a short list. You sell compliance automation, and this choice shapes a cold email, so be specific and honest.",
    "",
    "Rules:",
    "1. Choose exactly two, only from the pains listed. Never invent a pain.",
    "2. For each, write one plain sentence (under 250 characters) saying why it fits this person at this company, using only the evidence shown. No hype, no claims beyond the evidence.",
    "3. Cite evidence ids, using only the ids listed under the pain you chose. If a pain lists no evidence, cite none.",
    "4. Prefer pains that have evidence, and pains the person's role feels most.",
    "",
    UNTRUSTED_NOTICE,
  ].join("\n");
}

export function painsUserPrompt({ shortlist, contact, company }: Pick<ChooseInput, "shortlist" | "contact" | "company">, token: string): string {
  const person = wrapUntrusted("contact", `First name: ${clean(contact.firstName, 40)}\nTitle: ${clean(contact.title ?? "unknown", 80)}`, token);
  const list = shortlist.items.map((s) => {
    const ev = s.evidence.length
      ? s.evidence.map((e) => `  - ${e.id}: ${e.text}${e.quotes.length ? ` | on their site: ${wrapUntrusted("quote", e.quotes.slice(0, 2).join(" // "), token)}` : " | confirmed by checking their pages"}`).join("\n")
      : "  (no evidence from their site)";
    return `${s.pain.id}. ${s.pain.label}\n  Role fit: ${s.personaPoints}/30\n${ev}`;
  });
  return [`Company: ${clean(company.name, 80)} (${clean(company.domain, 80)})`, person, "", "Shortlist:", ...list, "", "Choose two."].join("\n");
}

type Validated = { ok: true; picks: { id: PainId; reason: string; evidenceIds: string[] }[] } | { ok: false; reason: string };

/** Holds the model's answer to the shortlist: two distinct listed pains, a real reason, and only evidence that exists. */
export function validatePicks(raw: unknown, shortlist: Shortlist): Validated {
  const picks = (raw as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(picks) || picks.length !== 2) return { ok: false, reason: "The answer did not contain exactly two picks." };
  const byId = new Map(shortlist.items.map((s) => [s.pain.id, s]));
  const out: { id: PainId; reason: string; evidenceIds: string[] }[] = [];
  for (const p of picks) {
    const o = p as { painId?: unknown; reason?: unknown; evidenceIds?: unknown } | null;
    const id = o?.painId;
    if (typeof id !== "string" || !byId.has(id as PainId)) return { ok: false, reason: `"${String(id).slice(0, 20)}" is not on the shortlist.` };
    if (out.some((x) => x.id === id)) return { ok: false, reason: "The same pain was picked twice." };
    const reason = typeof o?.reason === "string" ? clean(o.reason, MAX_REASON_CHARS + 1) : "";
    if (reason.length === 0 || reason.length > MAX_REASON_CHARS) return { ok: false, reason: `The reason for ${id} was empty or too long.` };
    const ids = o?.evidenceIds;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return { ok: false, reason: `The evidence for ${id} was not a list of ids.` };
    const allowed = new Set((byId.get(id as PainId) as ScoredPain).evidence.map((e) => e.id as string));
    const bad = (ids as string[]).find((x) => !allowed.has(x));
    if (bad !== undefined) return { ok: false, reason: `Evidence "${bad.slice(0, 30)}" does not exist for ${id}.` };
    if (allowed.size > 0 && ids.length === 0) return { ok: false, reason: `${id} has evidence but none was cited.` };
    out.push({ id: id as PainId, reason, evidenceIds: [...new Set(ids as string[])] });
  }
  return { ok: true, picks: out };
}

const toPick = (s: ScoredPain, reason: string, evidenceIds?: string[]): PainPick => ({
  id: s.pain.id,
  label: s.pain.label,
  plain: s.pain.plain,
  reason,
  evidence: evidenceIds ? s.evidence.filter((e) => evidenceIds.includes(e.id)) : s.evidence,
});

function fallback(shortlist: Shortlist, why: string, usage: Usage, model?: string): PainChoice {
  const picks = shortlist.items.slice(0, 2).map((s) => toPick(s, `Code fallback: highest score (${s.score}) on the shortlist, from ${s.signalPoints / 10} evidence signal(s) and role fit ${s.personaPoints}/30.`));
  return { source: "code_fallback", picks, shortlist, fallbackReason: why, usage, model, promptVersion: PAINS_PROMPT_VERSION };
}

export async function choosePains(input: ChooseInput): Promise<PainChoice> {
  const { ai, budget, shortlist } = input;
  if (shortlist.items.length < 2) return fallback(shortlist, "There were fewer than two pains to choose from.", NO_USAGE);
  const system = painsSystemPrompt();
  const user = painsUserPrompt(input, newDelimiter());
  try {
    budget.assertRoom(estimateTokens(system) + estimateTokens(user) + MAX_OUTPUT_TOKENS);
  } catch {
    return fallback(shortlist, "The token budget for this domain was used up.", NO_USAGE);
  }
  let usage: Usage = NO_USAGE;
  try {
    const res = await ai.generateJson({ purpose: "pains", system, user, schema: painsSchema(shortlist.items.map((s) => s.pain.id)), temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: input.timeoutMs ?? 30_000 });
    usage = addUsage(usage, res.usage);
    budget.charge(res.usage);
    const v = validatePicks(res.data, shortlist);
    if (!v.ok) return fallback(shortlist, v.reason, usage, res.model);
    const byId = new Map(shortlist.items.map((s) => [s.pain.id, s]));
    return { source: "model", picks: v.picks.map((p) => toPick(byId.get(p.id) as ScoredPain, p.reason, p.evidenceIds)), shortlist, usage, model: res.model, promptVersion: PAINS_PROMPT_VERSION };
  } catch (e) {
    return fallback(shortlist, e instanceof AiError ? e.message : "The model call failed.", usage);
  }
}
