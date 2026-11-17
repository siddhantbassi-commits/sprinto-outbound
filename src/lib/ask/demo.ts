import type { AiClient, Content, ToolTurn, Usage } from "@/lib/ai/types";

/**
 * Demo mode has no Gemini key, so Ask is answered by this stand-in. It picks lookups by keyword and writes the answer
 * from what they returned, using the same tools, checks and limits as the real thing. It understands a handful of
 * questions and says so for the rest. It proves the page and the safeguards work; it is not a language model.
 */

const USAGE: Usage = { promptTokens: 700, outputTokens: 120, totalTokens: 820 };
const LANE_WORDS: [RegExp, string][] = [
  [/needs? a person|waiting|review|maybe/i, "review"],
  [/no (usable )?contact|no person|nobody/i, "no_contact"],
  [/needs? more|too little|not enough/i, "needs_more"],
  [/not (a )?fit|rejected|ruled out|why .*skip/i, "not_fit"],
  [/\bheld\b/i, "held"],
  [/\bsent\b|emailed|delivered/i, "sent"],
  [/failed|broke|error/i, "failed"],
  [/unknown/i, "unknown"],
];

const questionOf = (contents: Content[]) => contents[0]?.parts[0]?.text ?? "";

function resultsOf(contents: Content[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const c of contents) {
    for (const p of c.parts) {
      const raw = (p.functionResponse?.response as { result?: string } | undefined)?.result;
      const m = raw ? /^<<<DATA [^\n]*>>>\n([\s\S]*)\n<<<END [0-9a-f]+>>>$/.exec(raw) : null;
      if (m) out.push(JSON.parse(m[1]!) as Record<string, unknown>);
    }
  }
  return out;
}

/** A request to change something, rather than a question. It gets no lookup, so it ends in the plain "I cannot do that". */
const COMMAND = /(^|\band\s|\bplease\s|\bcan you\s|\bcould you\s|\bnow\s)(send|delete|remove|promote|skip|edit|change|update|mark|resume|pause|start|add|email|resend)\b/i;

function choose(q: string): { name: string; args: Record<string, unknown> } | null {
  if (COMMAND.test(q)) return null;
  const domain = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i.exec(q)?.[0];
  if (domain) return { name: "company_story", args: { domain: domain.toLowerCase() } };
  if (/suppress|do[ -]not[ -]contact|don't contact|blocklist/i.test(q)) return { name: "list_suppressions", args: {} };
  if (/rules?\b|cap\b|test mode|settings|threshold/i.test(q)) return { name: "settings_and_rules", args: {} };
  if (/\bruns?\b/i.test(q)) return { name: "list_runs", args: {} };
  if (/funnel|impact|how many.*(sent|researched|added)|summary/i.test(q)) return { name: "impact_summary", args: { range: "all" } };
  for (const [re, lane] of LANE_WORDS) if (re.test(q)) return { name: "list_companies", args: { lane } };
  if (/how many|count|total|breakdown/i.test(q)) return { name: "count_by_outcome", args: {} };
  return null;
}

const label = (o: Record<string, unknown>) => String(o.lane_label ?? o.lane ?? "");

function write(r: Record<string, unknown>): string {
  if (r.found === false) return `I found no record of ${String(r.domain)}.`;
  if (r.found === true) {
    const s = r.scoring as { reason?: string; points?: { label: string; points: number; out_of: number }[] } | null;
    const lines = [`${String(r.domain)} is in the “${label(r)}” lane${r.lane_reason ? `: ${String(r.lane_reason).replace(/[.\s]+$/, "")}` : ""}.`];
    if (r.score !== null && r.score !== undefined) lines.push(`It scored ${String(r.score)} (${String(r.verdict).replace("_", " ")}).`);
    const top = (s?.points ?? []).slice(0, 3).map((p) => `${p.label} (${p.points} of ${p.out_of})`);
    if (top.length) lines.push(`Biggest reasons: ${top.join("; ")}.`);
    const e = r.outreach_email as { status?: string; subject?: string } | null;
    if (e) lines.push(`The email “${e.subject}” is ${e.status}.`);
    return lines.join(" ");
  }
  if (Array.isArray(r.companies)) {
    const list = r.companies as Record<string, unknown>[];
    if (list.length === 0) return "No companies match that.";
    return [`${String(r.total_matching)} ${Number(r.total_matching) === 1 ? "company matches" : "companies match"}:`, ...list.map((c) => `- ${String(c.domain)}: ${label(c)}${c.reason ? `, ${String(c.reason)}` : ""}`)].join("\n");
  }
  if (r.lanes) {
    const lanes = Object.entries(r.lanes as Record<string, number>).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ");
    return `There are ${String(r.total)} companies: ${lanes}.`;
  }
  if (Array.isArray(r.runs)) return `The ${(r.runs as unknown[]).length} most recent run${(r.runs as unknown[]).length === 1 ? "" : "s"}: ${(r.runs as Record<string, unknown>[]).map((x) => `${String(x.companies)} companies (${String(x.note || x.source)})`).join("; ")}.`;
  if (r.suppressions) return Number(r.count) === 0 ? "Nothing is on the do-not-contact list." : `${String(r.count)} on the do-not-contact list: ${(r.suppressions as { value: string; reason: string }[]).map((s) => `${s.value} (${s.reason})`).join("; ")}.`;
  if (r.domains_added !== undefined) return `${String(r.period)}: ${String(r.domains_added)} added, ${String(r.researched)} researched, ${String(r.qualified)} qualified, ${String(r.person_found)} with a person found, ${String(r.drafted)} drafted, ${String(r.sent_to_test_inbox)} sent to the test inbox.`;
  if (r.test_mode) return `Test mode: ${String(r.test_mode)}. The daily send cap is ${String(r.daily_send_cap)}. ICP version ${String(r.icp_version)}: qualified at ${String(r.qualified_at_score)}, maybe from ${String(r.maybe_from_score)}.`;
  return "I looked, but there was nothing to report.";
}

export function demoAskAi(): AiClient {
  return {
    async generateJson() {
      throw new Error("Ask does not use JSON mode.");
    },
    async generateTurn(req): Promise<ToolTurn> {
      const results = resultsOf(req.contents);
      const make = (text: string, calls: ToolTurn["calls"]): ToolTurn => ({ text, calls, finish: calls.length ? "tool_calls" : "stop", content: { role: "model", parts: [...(text ? [{ text }] : []), ...calls.map((c) => ({ functionCall: c }))] }, usage: USAGE, model: "demo-ask", latencyMs: 1 });
      if (results.length > 0) return make(results.map(write).join("\n"), []);
      const call = choose(questionOf(req.contents));
      return call ? make("", [call]) : make("I can only answer questions about the companies, runs, rules and funnel recorded here.", []);
    },
  };
}
