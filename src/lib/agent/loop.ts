import { TokenBudget, estimateTokens } from "@/lib/ai/budget";
import { AiError } from "@/lib/ai/errors";
import { UNTRUSTED_NOTICE } from "@/lib/ai/untrusted";
import { NO_USAGE, addUsage, type AiClient, type Content, type ToolDecl, type Usage } from "@/lib/ai/types";
import { extractFacts, type ExtractOk } from "@/lib/extract/extract";
import { ICP_V1, type IcpConfig } from "@/lib/icp/config";
import { coverage, scoreIcp } from "@/lib/icp/score";
import { emptyFacts, type Facts, type ScoreContext, type ScoreResult } from "@/lib/icp/types";
import type { FetchOutcome, Site } from "@/lib/scrape/site";

/**
 * Step 3's agent loop. When the first read leaves key facts unknown, Gemini may pick what to look at next, but only from
 * five tools that our code runs, with arguments our code checks. Code decides when to stop and then scores.
 * Every round is returned as a trace row, so the Why page can show why the system went to the careers page.
 */

export const AGENT_PROMPT_VERSION = "agent-v1";
export const MAX_ROUNDS = 4;
export const MAX_CALLS_PER_ROUND = 2;
const ROUND_OUTPUT_TOKENS = 512;

export const TOOLS: ToolDecl[] = [
  {
    name: "fetch_page",
    description: "Fetch one more page of this company's own website, for example /pricing or /security. Only paths listed as available can be fetched.",
    parameters: { type: "object", properties: { path: { type: "string", description: "A path that starts with /, such as /pricing" } }, required: ["path"] },
  },
  {
    name: "search_site",
    description: "Search the pages already fetched (and the list of known page addresses) for words. Fetches nothing new.",
    parameters: { type: "object", properties: { terms: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 } }, required: ["terms"] },
  },
  { name: "check_trust_center", description: "Look for the company's trust or security page, including a trust sub-domain.", parameters: { type: "object", properties: {} } },
  { name: "list_open_roles", description: "Fetch the company's careers page, or its own linked job board, to see which roles are open.", parameters: { type: "object", properties: {} } },
  { name: "stop", description: "Stop looking. Use this when more pages would not help.", parameters: { type: "object", properties: { reason: { type: "string" } } } },
];
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

const FACT_LABELS: Record<string, string> = {
  product: "what the company sells",
  headcount: "company size",
  enterprise: "enterprise signals (an Enterprise plan, large named customers, SSO/SAML/SCIM/audit logs)",
  compliance: "compliance status (SOC 2, ISO 27001, in progress or none)",
  securityHiring: "open security, GRC or IT-head roles",
  customerData: "whether the product holds customers' data",
};

export function agentSystemPrompt(): string {
  return [
    "You help decide which extra pages of a company's own website to read so that missing facts can be filled in.",
    "You may only call the tools provided. Prefer the page most likely to answer the missing facts: pricing or plans for enterprise signals, security or trust for compliance, careers for hiring and size, about for size.",
    "Call at most two tools at a time. Do not repeat a page that was already fetched. If more pages would not help, call stop.",
    "",
    UNTRUSTED_NOTICE,
  ].join("\n");
}

export type TraceTool = "fetch_page" | "search_site" | "check_trust_center" | "list_open_roles" | "stop" | "rejected";

export interface RoundTrace {
  round: number;
  /** What the loop was trying to learn (the unknown key facts). */
  missing: string[];
  tool: TraceTool;
  args: Record<string, unknown>;
  outcome: string;
  newPages: number;
  tokens: number;
}

export type StopReason = "enough" | "time" | "max_rounds" | "model_stopped" | "no_progress" | "budget" | "ai_error" | "extraction_failed";

export interface QualifyInput {
  ai: AiClient;
  site: Site;
  budget: TokenBudget;
  /** What the caller knows and the model must not: the blocklist and suppression decisions. */
  context: Pick<ScoreContext, "excludedDomain" | "suppressed">;
  cfg?: IcpConfig;
  /** Epoch milliseconds by which the loop must stop starting new rounds, so one invocation stays inside its time limit. */
  deadline?: number;
  now?: () => number;
}

/** A round (a model call, a fetch and a re-read) needs about this long; do not start one with less left. */
export const MIN_ROUND_MS = 15_000;

export interface QualifyResult {
  facts: Facts;
  score: ScoreResult;
  trace: RoundTrace[];
  rounds: number;
  stoppedBecause: StopReason;
  extraction: ExtractOk | null;
  /** Every extraction pass, so grounding failures and injection flags across the loop are all visible. */
  passes: ExtractOk[];
  usage: Usage;
  aiCalls: number;
  /** Why the model could not be used, when it could not. The caller decides whether that is worth a retry. */
  failure: { code: string; reason: string } | null;
}

type Args = Record<string, unknown>;

/** Checks a tool call's arguments. A call that fails here is recorded as rejected and never executed. */
export function validateCall(name: string, args: Args): { ok: true; args: Args } | { ok: false; reason: string } {
  if (!TOOL_NAMES.has(name)) return { ok: false, reason: `Unknown tool "${name}"` };
  if (name === "fetch_page") {
    const path = args.path;
    if (typeof path !== "string" || path.length === 0 || path.length > 200) return { ok: false, reason: "fetch_page needs a path under 200 characters" };
    return { ok: true, args: { path } };
  }
  if (name === "search_site") {
    const terms = args.terms;
    if (!Array.isArray(terms) || terms.length === 0 || terms.length > 5 || !terms.every((t) => typeof t === "string" && t.length > 0 && t.length <= 60)) {
      return { ok: false, reason: "search_site needs 1 to 5 terms of up to 60 characters" };
    }
    return { ok: true, args: { terms } };
  }
  if (name === "stop") return { ok: true, args: { reason: typeof args.reason === "string" ? args.reason.slice(0, 200) : "" } };
  return { ok: true, args: {} };
}

const summarise = (o: FetchOutcome) => (o.ok ? (o.fresh ? `Fetched ${new URL(o.page.url).pathname} (${o.page.text.length} characters${o.page.thin ? ", very little text" : ""})` : `Already had ${new URL(o.page.url).pathname}`) : `Could not fetch: ${o.reason}`);

function availableList(site: Site): string {
  const have = new Set(site.pages().map((p) => new URL(p.url).pathname));
  const paths = [...new Set(site.discovered().map((u) => new URL(u).pathname))].filter((p) => !have.has(p)).slice(0, 40);
  return paths.length ? paths.join(", ") : "(none found; the standard pricing, security, trust, about, customers and careers paths can still be tried)";
}

function roundPrompt(missing: string[], site: Site): string {
  return [
    `Company domain: ${site.domain}`,
    `Still unknown: ${missing.map((m) => FACT_LABELS[m] ?? m).join("; ")}.`,
    `Pages already read: ${site.pages().map((p) => new URL(p.url).pathname).join(", ") || "(none)"}.`,
    `Pages available to fetch: ${availableList(site)}.`,
    "Choose what to look at next.",
  ].join("\n");
}

const tokensOf = (u: Usage) => u.totalTokens;

export async function qualify({ ai, site, budget, context, cfg = ICP_V1, deadline, now = Date.now }: QualifyInput): Promise<QualifyResult> {
  const trace: RoundTrace[] = [];
  const passes: ExtractOk[] = [];
  let usage: Usage = NO_USAGE;
  let aiCalls = 0;
  let stoppedBecause: StopReason = "enough";
  let failure: QualifyResult["failure"] = null;

  const read = async () => {
    const res = await extractFacts({ ai, pages: site.pages(), budget });
    usage = addUsage(usage, res.usage);
    aiCalls += res.calls;
    if (res.ok) passes.push(res);
    return res;
  };
  const finish = (facts: Facts, rounds: number): QualifyResult => {
    const pages = site.pages();
    const score = scoreIcp(facts, { ...context, textChars: pages.reduce((n, p) => n + p.text.length, 0), pages: pages.length }, cfg);
    return { facts, score, trace, rounds, stoppedBecause, extraction: passes.at(-1) ?? null, passes, usage, aiCalls, failure };
  };

  const first = await read();
  if (!first.ok) {
    failure = { code: first.code, reason: first.reason };
    stoppedBecause = first.code === "budget" ? "budget" : "extraction_failed";
    return finish(emptyFacts(), 0);
  }
  let facts = first.facts;

  const contents: Content[] = [];
  let idle = 0;
  let round = 0;
  while (coverage(facts, cfg).known < cfg.minKnownKeyFacts) {
    if (round >= MAX_ROUNDS) {
      stoppedBecause = "max_rounds";
      break;
    }
    if (deadline !== undefined && now() > deadline - MIN_ROUND_MS) {
      stoppedBecause = "time";
      break;
    }
    round += 1;
    const missing = coverage(facts, cfg).missing as string[];
    const user: Content = { role: "user", parts: [{ text: roundPrompt(missing, site) }] };
    const system = agentSystemPrompt();
    const prompt = [...contents, user];
    if (!budget.canSpend(estimateTokens(system) + estimateTokens(JSON.stringify(prompt)) + ROUND_OUTPUT_TOKENS)) {
      stoppedBecause = "budget";
      round -= 1;
      break;
    }

    let turn;
    try {
      aiCalls += 1;
      turn = await ai.generateTurn({ purpose: "agent", system, contents: prompt, tools: TOOLS, mode: "AUTO", temperature: 0.2, maxOutputTokens: ROUND_OUTPUT_TOKENS });
    } catch (e) {
      stoppedBecause = e instanceof AiError && e.code === "budget" ? "budget" : "ai_error";
      if (e instanceof AiError) failure = { code: e.code, reason: e.message };
      trace.push({ round, missing, tool: "rejected", args: {}, outcome: e instanceof AiError ? e.message : "The model call failed.", newPages: 0, tokens: 0 });
      break;
    }
    usage = addUsage(usage, turn.usage);
    budget.charge(turn.usage);
    contents.push(user, turn.content);

    const calls = turn.calls.slice(0, MAX_CALLS_PER_ROUND);
    if (calls.length === 0) {
      // Talking without acting is the model saying it has nothing to add.
      trace.push({ round, missing, tool: "stop", args: {}, outcome: turn.text.slice(0, 200) || "The model made no tool call.", newPages: 0, tokens: tokensOf(turn.usage) });
      stoppedBecause = "model_stopped";
      break;
    }

    let added = 0;
    let stop = false;
    const responses: Content["parts"] = [];
    for (const call of calls) {
      const v = validateCall(call.name, call.args);
      if (!v.ok) {
        trace.push({ round, missing, tool: "rejected", args: { name: call.name }, outcome: v.reason, newPages: 0, tokens: tokensOf(turn.usage) });
        responses.push({ functionResponse: { name: call.name, response: { error: v.reason } } });
        continue;
      }
      let outcome = "";
      let fresh = 0;
      if (call.name === "stop") {
        stop = true;
        outcome = String(v.args.reason || "Stopped.");
      } else if (call.name === "search_site") {
        const r = site.searchSite(v.args.terms as string[]);
        outcome = `${r.hits.length} matching line(s), ${r.urls.length} matching address(es)`;
        responses.push({ functionResponse: { name: call.name, response: { hits: r.hits.slice(0, 5), urls: r.urls.slice(0, 5) } } });
      } else {
        const o = call.name === "fetch_page" ? await site.fetchPath(v.args.path as string) : call.name === "check_trust_center" ? await site.checkTrustCenter() : await site.listOpenRoles();
        outcome = summarise(o);
        if (o.ok && o.fresh) fresh = 1;
        responses.push({ functionResponse: { name: call.name, response: { result: outcome } } });
      }
      added += fresh;
      trace.push({ round, missing, tool: call.name as TraceTool, args: v.args, outcome, newPages: fresh, tokens: tokensOf(turn.usage) });
    }
    if (responses.length) contents.push({ role: "user", parts: responses });
    if (stop) {
      stoppedBecause = "model_stopped";
      break;
    }

    if (added > 0) {
      idle = 0;
      const again = await read();
      if (!again.ok) {
        failure = { code: again.code, reason: again.reason };
        stoppedBecause = again.code === "budget" ? "budget" : "extraction_failed";
        break;
      }
      facts = again.facts;
    } else {
      idle += 1;
      if (idle >= 2) {
        stoppedBecause = "no_progress";
        break;
      }
    }
  }
  if (coverage(facts, cfg).known >= cfg.minKnownKeyFacts) stoppedBecause = "enough";
  return finish(facts, round);
}
