import type { DbPort, Row } from "@/lib/db/port";
import { readHints, type Hints } from "@/lib/icp/hints";
import type { IcpConfig } from "@/lib/icp/config";
import type { Candidate } from "@/lib/contacts/rank";
import type { CachedSearch, ContactCache } from "@/lib/contacts/find";
import type { Facts, ScoreResult } from "@/lib/icp/types";
import type { StoredPage } from "@/lib/scrape/site";
import type { SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import type { PainPick } from "@/lib/pitch/choose-pains";

/** Everything the worker reads and writes, in terms of the pipeline, over the database port. */

export interface ProspectRow {
  id: string;
  run_id: string;
  domain: string;
  step: "queued" | "scraped" | "qualified" | "contact_found" | "pains_chosen" | "drafted" | "sent";
  lane: string;
  attempts: number;
  score: number | null;
  verdict: string | null;
}

export interface Settings {
  id: string;
  test_to: string | null;
  sender_name: string;
  sender_title: string;
  postal_address: string;
  daily_send_cap: number;
  max_run_size: number;
  max_parallel: number;
  hunter_reserve: number;
  tokens_per_domain: number;
  tokens_per_run: number;
  mail_cooldown_days: number;
  minutes_saved_per_email: number;
  review_minutes_per_email: number;
  review_minutes_per_decision: number;
  /** A person must approve each draft before it is sent. Defaults to on. */
  require_approval: boolean;
}

export interface EmailReview {
  id: string;
  email_id: string;
  action: "approve" | "reject";
  subject: string;
  body: string;
  edit_ratio: number;
  contact_ok: boolean;
  reason: string;
}

export interface EmailRow {
  id: string;
  prospect_id: string;
  attempt: number;
  subject: string;
  body: string;
  status: string;
  hook: { id: string; quote: string; source: string | null } | null;
  picks: PainPick[];
}

export interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  email: string | null;
  verification: string | null;
  confidence: number | null;
  rank_score: number | null;
  excluded: string | null;
  chosen: boolean;
}

export type ReserveResult = { ok: true; test_to: string } | { ok: false; reason: string };

const one = (rows: Row[]) => rows[0];
const scalar = (rows: Row[]) => (rows[0] ? Object.values(rows[0])[0] : undefined);

export class Store {
  constructor(readonly db: DbPort) {}

  // ----- the queue -----
  async claim(leaseSeconds = 120): Promise<ProspectRow | null> {
    return (one(await this.db.rpc("claim_next_prospect", { p_lease_seconds: leaseSeconds })) as unknown as ProspectRow) ?? null;
  }
  async advance(id: string, from: string, o: { output?: Row; model?: string; promptVersion?: string; tokens?: number; latencyMs?: number } = {}) {
    await this.db.rpc("advance_prospect", { p_prospect: id, p_from: from, p_output: o.output ?? {}, p_model: o.model ?? null, p_prompt_version: o.promptVersion ?? null, p_tokens: o.tokens ?? null, p_latency: o.latencyMs ?? null });
  }
  async park(id: string, from: string, lane: string, reason: string, o: { output?: Row; model?: string; promptVersion?: string; tokens?: number; latencyMs?: number } = {}) {
    await this.db.rpc("park_prospect", { p_prospect: id, p_from: from, p_lane: lane, p_reason: reason, p_output: o.output ?? {}, p_model: o.model ?? null, p_prompt_version: o.promptVersion ?? null, p_tokens: o.tokens ?? null, p_latency: o.latencyMs ?? null });
  }
  async fail(id: string, from: string, error: string, retryable: boolean) {
    await this.db.rpc("fail_prospect", { p_prospect: id, p_from: from, p_error: error, p_retryable: retryable });
  }
  async release(id: string) {
    await this.db.rpc("release_prospect", { p_prospect: id });
  }
  async sweepStuckSends(minutes = 10): Promise<number> {
    return Number(scalar(await this.db.rpc("sweep_stuck_sends", { p_minutes: minutes })) ?? 0);
  }
  async recordTick(source: "cron" | "browser", processed: number) {
    await this.db.rpc("record_tick", { p_source: source, p_processed: processed });
  }
  async retention(days = 90) {
    await this.db.rpc("run_retention", { p_days: days });
  }

  // ----- configuration, read from stored rows and never from the caller -----
  async settings(): Promise<Settings> {
    return one(await this.db.rpc("settings_now")) as unknown as Settings;
  }
  async factsFile(): Promise<SprintoFactsFile> {
    return one(await this.db.select("sprinto_facts_versions", {}, { order: "version", ascending: false, limit: 1 }))!.content as SprintoFactsFile;
  }
  async icpForRun(runId: string): Promise<{ id: string; config: IcpConfig; blocklist: string[] }> {
    const run = one(await this.db.select("runs", { id: runId }))!;
    const v = one(await this.db.select("icp_versions", { id: run.icp_version_id }))!;
    return { id: v.id as string, config: v.config as IcpConfig, blocklist: ((v.blocklist as { domains?: string[] } | null)?.domains ?? []) as string[] };
  }
  async isSuppressed(kind: "domain" | "address", value: string): Promise<boolean> {
    return scalar(await this.db.rpc("is_suppressed", { p_kind: kind, p_value: value })) === true;
  }
  async runTokens(runId: string): Promise<number> {
    return Number(scalar(await this.db.rpc("run_tokens", { p_run: runId })) ?? 0);
  }

  // ----- what the steps produce -----
  async insertPages(prospectId: string, pages: StoredPage[]) {
    if (pages.length === 0) return;
    await this.db.insert("pages", pages.map((p) => ({ prospect_id: prospectId, url: p.url, kind: p.kind, status: p.status, bytes: p.bytes, sha256: p.sha256, title: p.title, text: p.text, thin: p.thin, truncated: p.truncated, fetched_at: p.fetchedAt })));
  }
  async pages(prospectId: string): Promise<StoredPage[]> {
    const rows = await this.db.select("pages", { prospect_id: prospectId }, { order: "created_at" });
    return rows.map((r) => ({ url: r.url as string, kind: r.kind as StoredPage["kind"], status: r.status as number, bytes: r.bytes as number, sha256: r.sha256 as string, title: r.title as string, text: r.text as string, thin: r.thin as boolean, truncated: r.truncated as boolean, fetchedAt: new Date(r.fetched_at as string).toISOString() }));
  }
  async discovered(prospectId: string): Promise<string[]> {
    const rows = await this.db.select("step_events", { prospect_id: prospectId, step: "scrape", status: "ok" }, { order: "id", ascending: false, limit: 1 });
    return ((rows[0]?.output as { discovered?: string[] } | undefined)?.discovered ?? []) as string[];
  }
  async insertFacts(prospectId: string, passes: { facts: Facts; grounding: unknown; absences: unknown; injection: unknown; problems: unknown; model: string; promptVersion: string; truncated: boolean }[]) {
    if (passes.length === 0) return;
    // A company that is read again (a person asked for a re-run) adds passes after the ones it already has. Starting from 1
    // again would collide with the first reading, which is kept as history and never overwritten.
    const [last] = await this.db.select("facts", { prospect_id: prospectId }, { order: "pass", ascending: false, limit: 1, columns: "pass" });
    const offset = Number((last as { pass?: number } | undefined)?.pass ?? 0);
    await this.db.insert("facts", passes.map((p, i) => ({ prospect_id: prospectId, pass: offset + i + 1, facts: p.facts, grounding: p.grounding, absences: p.absences, injection: p.injection, problems: p.problems, model: p.model, prompt_version: p.promptVersion, truncated: p.truncated })));
  }
  async latestFacts(prospectId: string): Promise<Facts | null> {
    const rows = await this.db.select("facts", { prospect_id: prospectId }, { order: "pass", ascending: false, limit: 1 });
    return (rows[0]?.facts as Facts | undefined) ?? null;
  }
  async insertScore(prospectId: string, icpVersionId: string, s: ScoreResult) {
    await this.db.insert("scores", { prospect_id: prospectId, icp_version_id: icpVersionId, score: Math.round(s.score), verdict: s.verdict, parts: s.parts, gates: s.gates, missing: s.missing, flags: s.flags, reason: s.reason });
  }
  /**
   * A person promoted this company after it was scored a "maybe". That is their decision to carry on, so the company is not
   * read and scored again: it would be judged the same way and parked again, and the model would be paid twice.
   */
  async promotedAfterMaybe(prospectId: string): Promise<{ score: number } | null> {
    const [score] = await this.db.select("scores", { prospect_id: prospectId, replay: false }, { order: "created_at", ascending: false, limit: 1, columns: "score,verdict,created_at" });
    if (!score || score.verdict !== "maybe") return null;
    const decisions = await this.db.select("decisions", { prospect_id: prospectId }, { order: "seq", ascending: false, limit: 20, columns: "kind,created_at" });
    const last = decisions.find((d) => d.kind === "promote" || d.kind === "rerun");
    if (!last || last.kind !== "promote") return null;
    return new Date(last.created_at as string).getTime() >= new Date(score.created_at as string).getTime() ? { score: Number(score.score) } : null;
  }
  async latestScore(prospectId: string): Promise<{ score: number; verdict: string; parts: { label: string; points: number; quotes: string[] }[] } | null> {
    const r = one(await this.db.select("scores", { prospect_id: prospectId, replay: false }, { order: "created_at", ascending: false, limit: 1 }));
    return r ? { score: r.score as number, verdict: r.verdict as string, parts: r.parts as never } : null;
  }
  async usage(runId: string, prospectId: string | null, kind: "gemini_tokens" | "hunter_credits", units: number, model?: string) {
    if (units <= 0) return;
    await this.db.insert("usage_ledger", { run_id: runId, prospect_id: prospectId, kind, units, model: model ?? null });
  }

  // ----- hints -----
  /** What was known about this company before its site was read (the size band Hunter Discover found it under). */
  async hints(runId: string, domain: string): Promise<Hints> {
    return readHints((await this.db.select("prospect_hints", { run_id: runId, domain })) as unknown as { kind: string; value: string }[]);
  }

  // ----- contacts -----
  async manualContacts(domain: string): Promise<Candidate[]> {
    const rows = await this.db.select("manual_contacts", { domain });
    return rows.filter((r) => r.email).map((r) => ({ source: "manual" as const, firstName: (r.first_name as string) ?? null, lastName: (r.last_name as string) ?? null, position: (r.position as string) ?? null, email: r.email as string, type: "personal" as const, seniority: null, department: null, confidence: null, verification: null }));
  }
  async insertContacts(prospectId: string, rows: Row[]) {
    if (rows.length > 0) await this.db.insert("contacts", rows.map((r) => ({ ...r, prospect_id: prospectId })));
  }
  async contacts(prospectId: string): Promise<ContactRow[]> {
    return (await this.db.select("contacts", { prospect_id: prospectId })) as unknown as ContactRow[];
  }
  /** The Hunter cache, kept in the database so a refresh is a new row and the newest one wins. */
  contactCache(): ContactCache {
    return {
      get: async (domain: string): Promise<CachedSearch | null> => {
        const r = one(await this.db.rpc("hunter_cached", { p_domain: domain, p_days: 30 }));
        if (!r || r.id === null || r.id === undefined || r.response === null) return null;
        return { candidates: ((r.response as { candidates?: Candidate[] }).candidates ?? []) as Candidate[], fetchedAt: new Date(r.fetched_at as string).getTime() };
      },
      set: async (domain: string, value: CachedSearch) => {
        await this.db.insert("hunter_cache", { domain, response: { candidates: value.candidates }, fetched_at: new Date(value.fetchedAt).toISOString() });
      },
    };
  }

  // ----- pains and the draft -----
  async painPicks(prospectId: string): Promise<{ source: string; picks: PainPick[] } | null> {
    const rows = await this.db.select("step_events", { prospect_id: prospectId, step: "pains", status: "ok" }, { order: "id", ascending: false, limit: 1 });
    const o = rows[0]?.output as { source?: string; picks?: PainPick[] } | undefined;
    return o?.picks ? { source: o.source ?? "model", picks: o.picks } : null;
  }
  async insertEmail(prospectId: string, e: { subject: string; body: string; lint: unknown; hook: unknown; picks: unknown; status: "drafted" | "held" }) {
    const existing = await this.db.select("emails", { prospect_id: prospectId });
    const [row] = await this.db.insert("emails", { prospect_id: prospectId, domain: "set-by-database", attempt: existing.length + 1, subject: e.subject, body: e.body, lint: e.lint, hook: e.hook, picks: e.picks, status: e.status });
    return row!.id as string;
  }
  async sendableEmail(prospectId: string): Promise<EmailRow | null> {
    const rows = (await this.db.select("emails", { prospect_id: prospectId }, { order: "attempt", ascending: false })) as unknown as EmailRow[];
    return rows.find((r) => r.status === "drafted" || r.status === "failed") ?? null;
  }
  /** The person's decision on a draft, if there is one. The approved text (edited or not) is what gets sent. */
  async reviewFor(emailId: string): Promise<EmailReview | null> {
    const r = one(await this.db.select("email_reviews", { email_id: emailId }));
    return r ? ({ ...(r as unknown as EmailReview), edit_ratio: Number(r.edit_ratio) }) : null;
  }
  async reserveSend(emailId: string): Promise<ReserveResult> {
    const r = scalar(await this.db.rpc("reserve_send", { p_email: emailId })) as { ok: boolean; reason?: string; test_to?: string };
    return r.ok ? { ok: true, test_to: r.test_to as string } : { ok: false, reason: r.reason ?? "refused" };
  }
  async setEmailStatus(emailId: string, status: "sent" | "unknown" | "failed", o: { messageId?: string; threadId?: string | null; error?: string; retryable?: boolean } = {}) {
    await this.db.rpc("set_email_status", { p_email: emailId, p_status: status, p_message_id: o.messageId ?? null, p_thread_id: o.threadId ?? null, p_error: o.error ?? null, p_retryable: o.retryable ?? false, p_reason: null });
  }
}
