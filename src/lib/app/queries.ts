import type { ImpactInput } from "@/lib/app/impact";
import type { LiveInput, TraceEvent } from "@/lib/quality/live";
import type { Subject } from "@/lib/icp/replay";
import type { Facts } from "@/lib/icp/types";
import { selectAll } from "@/lib/db/all";
import type { DbPort, Row } from "@/lib/db/port";
import type { Settings } from "@/lib/worker/store";

/**
 * What the pages read. Each function takes the signed-in person's own database port, so what comes back is exactly
 * what their role may see (a viewer gets no contact addresses, a pending person gets nothing).
 */

export interface RunRow {
  id: string;
  created_at: string;
  created_by: string | null;
  source: string;
  domain_count: number;
  note: string;
}
export interface ProspectLite {
  id: string;
  run_id: string;
  domain: string;
  step: string;
  lane: string;
  lane_reason: string | null;
  score: number | null;
  verdict: string | null;
  attempts: number;
  next_run_at: string;
  lease_until: string | null;
  updated_at: string;
}

const rows = <T>(r: Row[]) => r as unknown as T[];

export async function workerStatus(db: DbPort): Promise<{ lastTick: string | null; checkedAt: string }> {
  const [r] = await db.select("worker_status");
  return { lastTick: (r?.last_tick as string | null) ?? null, checkedAt: (r?.checked_at as string) ?? new Date().toISOString() };
}

export const currentSettings = async (db: DbPort): Promise<(Settings & { version: number; created_at: string }) | null> => {
  const [r] = await db.select("settings_versions", {}, { order: "version", ascending: false, limit: 1 });
  return (r as unknown as Settings & { version: number; created_at: string }) ?? null;
};

export interface RunSummary extends RunRow {
  counts: Record<string, number>;
  paused: boolean;
}

export async function listRuns(db: DbPort, limit = 30): Promise<RunSummary[]> {
  const runs = rows<RunRow>(await db.select("runs", {}, { order: "created_at", ascending: false, limit }));
  if (runs.length === 0) return [];
  const prospects = rows<ProspectLite>(await selectAll(db, "prospects", {}, { order: "created_at", ascending: false }));
  const decisions = await db.select("decisions", {}, { order: "seq", ascending: false, limit: 500 });
  return runs.map((run) => {
    const counts: Record<string, number> = {};
    for (const p of prospects) if (p.run_id === run.id) counts[p.lane] = (counts[p.lane] ?? 0) + 1;
    const last = decisions.find((d) => d.run_id === run.id && (d.kind === "pause_run" || d.kind === "resume_run"));
    return { ...run, counts, paused: last?.kind === "pause_run" };
  });
}

export async function getRun(db: DbPort, id: string) {
  const [run] = rows<RunRow & { icp_version_id: string; facts_version_id: string; settings_version_id: string }>(await db.select("runs", { id }));
  if (!run) return null;
  const prospects = rows<ProspectLite>(await db.select("prospects", { run_id: id }, { order: "domain" }));
  const decisions = await db.select("decisions", { run_id: id }, { order: "seq", ascending: false, limit: 50 });
  const last = decisions.find((d) => d.kind === "pause_run" || d.kind === "resume_run");
  const tokens = (await db.select("usage_ledger", { run_id: id, kind: "gemini_tokens" })).reduce((n, r) => n + Number(r.units), 0);
  const credits = (await db.select("usage_ledger", { run_id: id, kind: "hunter_credits" })).reduce((n, r) => n + Number(r.units), 0);
  const events = (await db.select("step_events", { run_id: id }, { order: "id", ascending: false, limit: 30, columns: "id,prospect_id,step,status,created_at" })) as unknown as { id: number; prospect_id: string; step: string; status: string; created_at: string }[];
  return { run, prospects, paused: last?.kind === "pause_run", tokens, credits, events, decisions: decisions as unknown as { prospect_id: string | null; kind: string; reason: string; created_at: string }[] };
}

export interface ReviewItem extends ProspectLite {
  domain: string;
}

/** Everything that is waiting on a person, newest first. */
export async function needsAttention(db: DbPort): Promise<ReviewItem[]> {
  const lanes = ["review", "held", "unknown", "failed", "no_contact", "needs_more"];
  const all = rows<ReviewItem>(await selectAll(db, "prospects", {}, { order: "updated_at", ascending: false }));
  return all.filter((p) => lanes.includes(p.lane));
}

export interface EventRow {
  id: number;
  step: string;
  status: string;
  output: Record<string, unknown>;
  model: string | null;
  prompt_version: string | null;
  tokens: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

export async function getProspect(db: DbPort, id: string, canSeeContacts: boolean) {
  const [prospect] = rows<ProspectLite & { created_at: string }>(await db.select("prospects", { id }));
  if (!prospect) return null;
  const [run] = await db.select("runs", { id: prospect.run_id });
  const events = rows<EventRow>(await db.select("step_events", { prospect_id: id }, { order: "id" }));
  const pages = (await db.select("pages", { prospect_id: id }, { order: "created_at" })) as Row[];
  const facts = await db.select("facts", { prospect_id: id }, { order: "pass" });
  const [score] = await db.select("scores", { prospect_id: id, replay: false }, { order: "created_at", ascending: false, limit: 1 });
  const contacts = canSeeContacts ? await db.select("contacts", { prospect_id: id }) : await db.select("contacts_masked", { prospect_id: id });
  const emails = await db.select("emails", { prospect_id: id }, { order: "attempt" });
  const decisions = await db.select("decisions", { prospect_id: id }, { order: "seq", ascending: false });
  const reviews = await db.select("email_reviews", { prospect_id: id }, { order: "created_at", ascending: false });
  return { prospect, run: run as Row, events, pages, facts, score: score as Row | undefined, contacts, emails, decisions, reviews };
}

export interface SuppressionNow {
  kind: string;
  value: string;
  reason: string;
  created_at: string;
}

/** The suppressions in force: for each value, its newest row, if that row is an add. */
export async function activeSuppressions(db: DbPort): Promise<SuppressionNow[]> {
  const all = await db.select("suppressions", {}, { order: "seq", ascending: false, limit: 1000 });
  const seen = new Set<string>();
  const out: SuppressionNow[] = [];
  for (const r of all) {
    const key = `${r.kind}:${r.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.action === "add") out.push({ kind: r.kind as string, value: r.value as string, reason: r.reason as string, created_at: r.created_at as string });
  }
  return out;
}

export async function settingsPage(db: DbPort) {
  const settings = await currentSettings(db);
  const icp = rows<{ id: string; version: number; config: Record<string, unknown>; reason: string; created_at: string }>(await db.select("icp_versions", {}, { order: "version", ascending: false, limit: 5 }));
  const signoffs = await db.select("icp_signoffs", {}, { order: "created_at", ascending: false, limit: 50 });
  const [file] = await db.select("sprinto_facts_versions", {}, { order: "version", ascending: false, limit: 1 });
  const manual = await db.select("manual_contacts", {}, { order: "created_at", ascending: false, limit: 50 });
  return { settings, icp, signoffs, file: file as Row | undefined, suppressions: await activeSuppressions(db), manual };
}

export async function people(db: DbPort) {
  return rows<{ id: string; email: string | null; role: string; created_at: string }>(await db.select("profiles", {}, { order: "created_at" }));
}

/** Everything the Impact view counts, read in pages and only in the columns it needs (page text is never pulled). */
export async function impactData(db: DbPort): Promise<Omit<ImpactInput, "range" | "assumptions">> {
  const all = <T,>(table: string, where: Row, columns: string, order: string) => selectAll(db, table, where, { order, columns }, 20_000) as unknown as Promise<T[]>;
  const [prospects, events, draftEvents, facts, pages, usage, decisions] = await Promise.all([
    all<ImpactInput["prospects"][number]>("prospects", {}, "id,lane,lane_reason,verdict,created_at", "created_at"),
    all<ImpactInput["events"][number]>("step_events", {}, "prospect_id,step,status,latency_ms", "id"),
    all<ImpactInput["draftEvents"][number]>("step_events", { step: "draft" }, "prospect_id,status,output", "id"),
    all<ImpactInput["facts"][number]>("facts", {}, "prospect_id,pass,grounding", "created_at"),
    all<ImpactInput["pages"][number]>("pages", {}, "prospect_id,thin", "created_at"),
    all<ImpactInput["usage"][number]>("usage_ledger", {}, "prospect_id,kind,units", "id"),
    all<ImpactInput["decisions"][number]>("decisions", {}, "prospect_id,kind,created_at", "seq"),
  ]);
  return { prospects, events, draftEvents, facts, pages, usage, decisions };
}

/** Every company that was read and scored, with its latest facts and what the qualify step saw, ready to replay. */
export async function replaySubjects(db: DbPort): Promise<Subject[]> {
  const [prospects, facts, qualify, supp, scores, versions] = await Promise.all([
    selectAll(db, "prospects", {}, { order: "created_at", columns: "id,domain,verdict,score" }, 20_000),
    selectAll(db, "facts", {}, { order: "created_at", columns: "prospect_id,pass,facts" }, 20_000),
    selectAll(db, "step_events", { step: "qualify" }, { order: "id", columns: "prospect_id,output" }, 20_000),
    activeSuppressions(db),
    selectAll(db, "scores", { replay: false }, { order: "created_at", columns: "prospect_id,icp_version_id" }, 20_000),
    db.select("icp_versions", {}, { columns: "id,version", order: "version" }),
  ]);
  const versionOf = new Map(versions.map((v) => [String(v.id), Number(v.version)]));
  const scoredUnder = new Map<string, number>();
  for (const sc of scores) scoredUnder.set(String(sc.prospect_id), versionOf.get(String(sc.icp_version_id)) ?? 0);
  const lastFacts = new Map<string, { pass: number; facts: Facts }>();
  for (const f of facts) {
    const id = String(f.prospect_id);
    if (!lastFacts.has(id) || Number(f.pass) > (lastFacts.get(id) as { pass: number }).pass) lastFacts.set(id, { pass: Number(f.pass), facts: f.facts as Facts });
  }
  // The latest qualify event per prospect (events arrive in id order).
  const seen = new Map<string, { text_chars?: number; pages?: number }>();
  for (const e of qualify) seen.set(String(e.prospect_id), (e.output ?? {}) as { text_chars?: number; pages?: number });
  const blocked = new Set(supp.filter((x) => x.kind === "domain").map((x) => x.value));
  return prospects.flatMap((p) => {
    const f = lastFacts.get(String(p.id));
    if (!f || !p.verdict) return [];
    const q = seen.get(String(p.id));
    return [{ id: String(p.id), domain: String(p.domain), stored: { verdict: p.verdict as Subject["stored"]["verdict"], score: p.score === null ? null : Number(p.score), version: scoredUnder.get(String(p.id)) ?? null }, facts: f.facts, textChars: typeof q?.text_chars === "number" ? q.text_chars : null, pages: typeof q?.pages === "number" ? q.pages : null, suppressed: blocked.has(String(p.domain)) }];
  });
}

export interface IcpVersionRow {
  id: string;
  version: number;
  config: import("@/lib/icp/config").IcpConfig;
  blocklist: { domains?: string[] } | null;
  reason: string;
  created_at: string;
  created_by: string | null;
}

export async function icpVersions(db: DbPort): Promise<{ versions: IcpVersionRow[]; signed: Set<string> }> {
  const versions = rows<IcpVersionRow>(await db.select("icp_versions", {}, { order: "version", ascending: false, limit: 50 }));
  const signoffs = await db.select("icp_signoffs", {}, { order: "created_at", ascending: false, limit: 200 });
  return { versions, signed: new Set(signoffs.map((x) => String(x.icp_version_id))) };
}

/** What the live quality readings count: the Impact data, plus the trace's model and timing columns and the queue's state now. */
export async function liveData(db: DbPort, now: number, days = 7): Promise<LiveInput> {
  const since = new Date(now - 2 * days * 86_400_000).toISOString();
  const [impact, events, status, active, unknown] = await Promise.all([
    impactData(db),
    // Only the last two windows are needed, so the read does not grow with the history.
    selectAll(db, "step_events", {}, { order: "id", columns: "prospect_id,step,status,latency_ms,model,prompt_version,tokens,created_at" }, 50_000).then((r) => (r as unknown as TraceEvent[]).filter((e) => new Date(e.created_at).toISOString() >= since)),
    workerStatus(db),
    db.select("prospects", { lane: "active" }, { columns: "id", limit: 1000 }),
    db.select("prospects", { lane: "unknown" }, { columns: "id", limit: 1000 }),
  ]);
  return { now, days, impact, events, lastTick: status.lastTick, activeNow: active.length, unknownNow: unknown.length };
}

export interface CompanyHit {
  id: string;
  domain: string;
  lane: string;
  verdict: string | null;
}

/** The newest companies by name, for search. Only what the search box shows, and capped, so it stays cheap on every page. */
export async function companyIndex(db: DbPort, limit = 300): Promise<CompanyHit[]> {
  return rows<CompanyHit>(await db.select("prospects", {}, { order: "created_at", ascending: false, limit, columns: "id,domain,lane,verdict" }));
}

export interface ReviewHistoryRow {
  prospect_id: string;
  action: "approve" | "reject";
  edit_ratio: number | string;
  contact_ok: boolean;
  reason: string;
  created_at: string;
}

/** Every decision a person made on a draft, oldest first, for the kill-criteria scorecard. */
export async function reviewHistory(db: DbPort): Promise<ReviewHistoryRow[]> {
  return (await selectAll(db, "email_reviews", {}, { order: "created_at", columns: "prospect_id,action,edit_ratio,contact_ok,reason,created_at" }, 20_000)) as unknown as ReviewHistoryRow[];
}
