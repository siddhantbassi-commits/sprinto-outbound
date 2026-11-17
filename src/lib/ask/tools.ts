import { computeImpact, rangeFor, type ImpactInput } from "@/lib/app/impact";
import { LANES, VERDICTS } from "@/lib/app/format";
import { activeSuppressions, impactData } from "@/lib/app/queries";
import { selectAll } from "@/lib/db/all";
import type { DbPort, Row } from "@/lib/db/port";
import type { ToolDecl } from "@/lib/ai/types";

/**
 * The only things Ask can do: read. Seven tools, each a fixed query run as the signed-in person's own database session,
 * so what comes back is exactly what that person may see. None can write, none takes SQL, and none returns a contact's
 * name or address: the model sees a role, a seniority and a confidence, never a person. Arguments are checked here,
 * not trusted, and every result is capped so one answer cannot pull a whole table into the model.
 */

const LANE_KEYS = Object.keys(LANES);
const VERDICT_KEYS = Object.keys(VERDICTS);
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LIST = 25;
const QUOTE = 180;

export const ASK_TOOLS: ToolDecl[] = [
  {
    name: "list_companies",
    description: "List companies, newest first, optionally filtered by outcome (lane), verdict, part of a domain name, or run. Returns each company's domain, lane, reason, verdict and score, plus how many matched in total.",
    parameters: {
      type: "object",
      properties: {
        lane: { type: "string", enum: LANE_KEYS, description: "Where the company ended up, for example review, not_fit, needs_more, no_contact, held, sent" },
        verdict: { type: "string", enum: VERDICT_KEYS },
        domain_contains: { type: "string", description: "Part of a domain name, lower case" },
        run_id: { type: "string", description: "A run's id, from list_runs" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIST },
      },
    },
  },
  {
    name: "company_story",
    description: "Everything recorded about one company: its outcome, score and the reason for each point, the facts read with their quotes, the steps taken, the person chosen (role only), the email and its checks, and any human decisions.",
    parameters: { type: "object", properties: { domain: { type: "string", description: "The company's domain, for example acme.com" } }, required: ["domain"] },
  },
  { name: "count_by_outcome", description: "How many companies are in each lane and each verdict, optionally for one run.", parameters: { type: "object", properties: { run_id: { type: "string" } } } },
  { name: "list_runs", description: "The most recent runs, with how many companies each had and where they ended up.", parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10 } } } },
  { name: "list_suppressions", description: "The do-not-contact list in force now: domains and addresses that will never be mailed, and why.", parameters: { type: "object", properties: {} } },
  { name: "impact_summary", description: "The funnel and rates over the last 7 days, the last 30 days, or all time: how many were added, read, qualified, found a person, drafted and sent, and where the rest went.", parameters: { type: "object", properties: { range: { type: "string", enum: ["7", "30", "all"] } } } },
  { name: "settings_and_rules", description: "The current send rules (daily cap, test mode recipient state), the ICP version in force and its thresholds. Does not return any secret.", parameters: { type: "object", properties: {} } },
];
const NAMES = new Set(ASK_TOOLS.map((t) => t.name));

export type Args = Record<string, unknown>;
export type Validated = { ok: true; args: Args } | { ok: false; reason: string };

const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v.trim() : undefined);

export function validateAsk(name: string, a: Args): Validated {
  if (!NAMES.has(name)) return { ok: false, reason: `Unknown tool "${name}".` };
  const out: Args = {};
  const bad = (reason: string): Validated => ({ ok: false, reason });
  const limit = (max: number) => {
    if (a.limit === undefined) return true;
    if (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > max) return false;
    out.limit = a.limit;
    return true;
  };
  const runId = () => {
    if (a.run_id === undefined) return true;
    const id = str(a.run_id, 40)?.toLowerCase();
    if (!id || !UUID.test(id)) return false;
    out.run_id = id;
    return true;
  };
  switch (name) {
    case "list_companies": {
      if (a.lane !== undefined) {
        if (typeof a.lane !== "string" || !LANE_KEYS.includes(a.lane)) return bad(`lane must be one of: ${LANE_KEYS.join(", ")}.`);
        out.lane = a.lane;
      }
      if (a.verdict !== undefined) {
        if (typeof a.verdict !== "string" || !VERDICT_KEYS.includes(a.verdict)) return bad(`verdict must be one of: ${VERDICT_KEYS.join(", ")}.`);
        out.verdict = a.verdict;
      }
      if (a.domain_contains !== undefined) {
        const d = str(a.domain_contains, 60)?.toLowerCase();
        if (!d || !/^[a-z0-9.-]+$/.test(d)) return bad("domain_contains must be letters, digits, dots and hyphens, up to 60 characters.");
        out.domain_contains = d;
      }
      if (!runId()) return bad("run_id must be a run's id from list_runs.");
      if (!limit(MAX_LIST)) return bad(`limit must be a whole number from 1 to ${MAX_LIST}.`);
      return { ok: true, args: out };
    }
    case "company_story": {
      const d = str(a.domain, 120)?.toLowerCase();
      if (!d || !DOMAIN.test(d)) return bad("company_story needs a domain such as acme.com.");
      return { ok: true, args: { domain: d } };
    }
    case "count_by_outcome":
      return runId() ? { ok: true, args: out } : bad("run_id must be a run's id from list_runs.");
    case "list_runs":
      return limit(10) ? { ok: true, args: out } : bad("limit must be a whole number from 1 to 10.");
    case "impact_summary":
      if (a.range !== undefined) {
        if (a.range !== "7" && a.range !== "30" && a.range !== "all") return bad('range must be "7", "30" or "all".');
        out.range = a.range;
      }
      return { ok: true, args: out };
    default:
      return { ok: true, args: {} };
  }
}

export interface ToolResult {
  /** What the model is given. */
  data: Record<string, unknown>;
  /** One line for the person: what was looked up. */
  summary: string;
  /** Companies this result named, so the page can link each to its Why page and the answer can be checked against them. */
  companies: { domain: string; id: string }[];
}

const cut = (s: unknown, n = QUOTE) => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n)}…` : s) : s);
const rows = <T,>(r: Row[]) => r as unknown as T[];

interface P { id: string; run_id: string; domain: string; step: string; lane: string; lane_reason: string | null; score: number | null; verdict: string | null; created_at: string }

const lite = (p: P) => ({ domain: p.domain, lane: p.lane, lane_label: LANES[p.lane]?.label, reason: cut(p.lane_reason, 200), verdict: p.verdict, score: p.score, step: p.step });
const link = (ps: P[]) => ps.map((p) => ({ domain: p.domain, id: p.id }));

async function prospects(db: DbPort): Promise<P[]> {
  return rows<P>(await selectAll(db, "prospects", {}, { order: "created_at", ascending: false, columns: "id,run_id,domain,step,lane,lane_reason,score,verdict,created_at" }, 20_000));
}

function tally(ps: P[]) {
  const lanes: Record<string, number> = {};
  const verdicts: Record<string, number> = {};
  for (const p of ps) {
    lanes[p.lane] = (lanes[p.lane] ?? 0) + 1;
    if (p.verdict) verdicts[p.verdict] = (verdicts[p.verdict] ?? 0) + 1;
  }
  return { lanes, verdicts };
}

/** Runs one validated tool. Anything it cannot find comes back as a plain statement, never a guess. */
export async function runAskTool(db: DbPort, name: string, args: Args): Promise<ToolResult> {
  switch (name) {
    case "list_companies": {
      let all = await prospects(db);
      if (args.run_id) all = all.filter((p) => p.run_id === args.run_id);
      if (args.lane) all = all.filter((p) => p.lane === args.lane);
      if (args.verdict) all = all.filter((p) => p.verdict === args.verdict);
      if (args.domain_contains) all = all.filter((p) => p.domain.includes(String(args.domain_contains)));
      const shown = all.slice(0, Number(args.limit ?? 15));
      return { data: { total_matching: all.length, shown: shown.length, companies: shown.map(lite) }, summary: `Listed ${shown.length} of ${all.length} matching companies${args.lane ? ` in the ${args.lane} lane` : ""}`, companies: link(shown) };
    }
    case "company_story":
      return story(db, String(args.domain));
    case "count_by_outcome": {
      let all = await prospects(db);
      if (args.run_id) all = all.filter((p) => p.run_id === args.run_id);
      return { data: { total: all.length, ...tally(all) }, summary: `Counted ${all.length} companies by outcome`, companies: [] };
    }
    case "list_runs": {
      const runs = await db.select("runs", {}, { order: "created_at", ascending: false, limit: Number(args.limit ?? 5) });
      const all = await prospects(db);
      const out = runs.map((r) => ({ run_id: r.id, created_at: r.created_at, source: r.source, note: cut(r.note, 100), companies: all.filter((p) => p.run_id === r.id).length, lanes: tally(all.filter((p) => p.run_id === r.id)).lanes }));
      return { data: { runs: out }, summary: `Listed the ${out.length} most recent runs`, companies: [] };
    }
    case "list_suppressions": {
      const s = (await activeSuppressions(db)).slice(0, 50);
      return { data: { count: s.length, suppressions: s.map((x) => ({ kind: x.kind, value: x.kind === "email" ? maskAddress(x.value) : x.value, reason: cut(x.reason, 150), since: x.created_at })) }, summary: `Read the do-not-contact list (${s.length})`, companies: [] };
    }
    case "impact_summary": {
      const now = Date.now();
      const data = await impactData(db);
      const input: ImpactInput = { ...data, range: rangeFor(String(args.range ?? "30"), now), assumptions: { manualMinutes: 0, reviewMinutesPerEmail: 0, reviewMinutesPerDecision: 0 } };
      const x = computeImpact(input);
      return {
        data: { period: x.range.label, domains_added: x.domains, researched: x.researched, qualified: x.qualified, person_found: x.contactFound, drafted: x.drafted, sent_to_test_inbox: x.sent, where_the_rest_went: x.dropoffs.map((d) => ({ outcome: d.lane, companies: d.count, most_common_reason: d.reasons[0]?.text ?? null })), tokens_used: x.usage.tokens },
        summary: `Read the funnel for ${x.range.label.toLowerCase()}`,
        companies: [],
      };
    }
    case "settings_and_rules": {
      const [s] = await db.select("settings_versions", {}, { order: "version", ascending: false, limit: 1 });
      const [icp] = await db.select("icp_versions", {}, { order: "version", ascending: false, limit: 1 });
      const cfg = (icp?.config ?? {}) as Record<string, unknown>;
      return {
        data: { settings_version: s?.version ?? null, daily_send_cap: s?.daily_send_cap ?? null, test_mode: "on: every email goes only to the owner's own address", icp_version: icp?.version ?? null, qualified_at_score: cfg.qualifyAt ?? null, maybe_from_score: cfg.maybeAt ?? null },
        summary: "Read the send rules and the ICP thresholds",
        companies: [],
      };
    }
    default:
      return { data: { error: "Unknown tool." }, summary: "Unknown tool", companies: [] };
  }
}

const maskAddress = (v: string) => (v.includes("@") ? `${v[0]}***@${v.split("@")[1]}` : v);

async function story(db: DbPort, domain: string): Promise<ToolResult> {
  const found = rows<P>(await db.select("prospects", { domain }, { order: "created_at", ascending: false, limit: 5 }));
  const p = found[0];
  if (!p) return { data: { found: false, domain, note: "No company with this domain has been run." }, summary: `Looked up ${domain}: not found`, companies: [] };
  const [score] = await db.select("scores", { prospect_id: p.id, replay: false }, { order: "created_at", ascending: false, limit: 1 });
  const factRows = await db.select("facts", { prospect_id: p.id }, { order: "pass", ascending: false, limit: 1 });
  const events = await db.select("step_events", { prospect_id: p.id }, { order: "id", limit: 40 });
  const contacts = await db.select("contacts_masked", { prospect_id: p.id });
  const emails = await db.select("emails", { prospect_id: p.id }, { order: "attempt", ascending: false, limit: 1 });
  const decisions = await db.select("decisions", { prospect_id: p.id }, { order: "seq", ascending: false, limit: 10 });

  const facts = (factRows[0]?.facts ?? {}) as Record<string, { value: unknown; confidence?: string; quotes?: string[] }>;
  const known = Object.entries(facts)
    .filter(([, f]) => f && f.value !== null && f.value !== undefined && f.confidence !== "low")
    .map(([k, f]) => ({ fact: k, value: f.value, quote: cut(f.quotes?.[0] ?? "") || undefined }));
  const parts = ((score?.parts ?? []) as { label: string; points: number; max: number; quotes?: string[] }[]).filter((x) => x.points !== 0).map((x) => ({ label: x.label, points: x.points, out_of: x.max, quote: cut(x.quotes?.[0] ?? "") || undefined }));
  const gates = ((score?.gates ?? []) as { label: string; status: string; detail: string }[]).filter((g) => g.status !== "pass").map((g) => ({ gate: g.label, status: g.status, detail: cut(g.detail, 200) }));
  const mail = emails[0];
  const data = {
    found: true,
    domain,
    lane: p.lane,
    lane_label: LANES[p.lane]?.label,
    lane_reason: cut(p.lane_reason, 300),
    verdict: p.verdict,
    score: p.score,
    scoring: score ? { reason: cut(score.reason, 300), points: parts, failed_or_unknown_gates: gates, still_unknown: score.missing, flags: score.flags } : null,
    facts_read: known,
    steps: events.map((e) => ({ step: e.step, status: e.status, error: cut(e.error, 120) || undefined, model: e.model || undefined })),
    chosen_contact: contacts.filter((c) => c.chosen).map((c) => ({ role: c.position, seniority: c.seniority, department: c.department, source: c.source, confidence: c.confidence })),
    contacts_considered: contacts.length,
    outreach_email: mail ? { status: mail.status, subject: cut(mail.subject, 120), checks_failed: ((mail.lint ?? []) as { id: string; pass: boolean }[]).filter((c) => !c.pass).map((c) => c.id), hook_quote: cut((mail.hook as { quote?: string } | null)?.quote ?? "") || undefined } : null,
    human_decisions: decisions.map((d) => ({ decision: d.kind, reason: cut(d.reason, 150), at: d.created_at })),
  };
  return { data, summary: `Read everything recorded about ${domain}`, companies: [{ domain, id: p.id }] };
}
