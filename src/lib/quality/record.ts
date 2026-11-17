import type { AiClient } from "@/lib/ai/types";
import type { DbPort, Row } from "@/lib/db/port";
import { ICP_V1, type IcpConfig } from "@/lib/icp/config";
import { runGolden, type CaseResult, type GoldenRun, type GoldenStatus } from "./harness";

/** Running the golden set and keeping what came of it. Shared by the button, the weekly job and the command line. */

export type Source = "live" | "scripted";
export type Trigger = "manual" | "weekly";

/** The ICP a real company would be scored under today: the newest version that has been signed off. */
export async function currentIcp(db: DbPort): Promise<{ id: string | null; version: number | null; config: IcpConfig }> {
  const versions = await db.select("icp_versions", {}, { order: "version", ascending: false, limit: 20 });
  const signed = new Set((await db.select("icp_signoffs", {}, { order: "created_at", ascending: false, limit: 200 })).map((x) => String(x.icp_version_id)));
  const v = versions.find((x) => signed.has(String(x.id)));
  // With nothing signed off yet, the built-in rubric is the fallback, and the run says it used no recorded version.
  return v ? { id: String(v.id), version: Number(v.version), config: v.config as IcpConfig } : { id: null, version: null, config: ICP_V1 };
}

export interface GoldenRow {
  id: string;
  trigger: Trigger;
  source: Source;
  models: string[];
  prompt_version: string;
  icp_version_id: string | null;
  cases: number;
  accuracy: number;
  wrong_rate: number;
  verdict_agreement: number;
  spurious: number;
  tokens: number;
  status: GoldenStatus;
  reasons: string[];
  detail: CaseResult[];
  created_at: string;
  created_by: string | null;
}

const n = (v: unknown) => Number(v);
const fromRow = (r: Row): GoldenRow => ({ ...(r as unknown as GoldenRow), accuracy: n(r.accuracy), wrong_rate: n(r.wrong_rate), verdict_agreement: n(r.verdict_agreement), cases: n(r.cases), spurious: n(r.spurious), tokens: n(r.tokens) });

export async function goldenRuns(db: DbPort, limit = 30): Promise<GoldenRow[]> {
  return (await db.select("golden_runs", {}, { order: "created_at", ascending: false, limit })).map(fromRow);
}

/** A run is refused if another was recorded this recently, so a double-click or a runaway job cannot spend the model's quota. */
export const COOLDOWN_MS = 2 * 60_000;

export type Recorded = { ok: true; id: string; run: GoldenRun; icpVersion: number | null } | { ok: false; reason: string };

export async function runAndRecord(o: { db: DbPort; ai: AiClient; source: Source; trigger: Trigger; now?: number }): Promise<Recorded> {
  const latest = (await goldenRuns(o.db, 1))[0];
  const now = o.now ?? Date.now();
  if (latest && now - new Date(latest.created_at).getTime() < COOLDOWN_MS) return { ok: false, reason: "The golden set was run less than two minutes ago. Wait a moment, then try again." };

  const icp = await currentIcp(o.db);
  const run = await runGolden({ ai: o.ai, cfg: icp.config });
  const s = run.summary;
  const models = [...new Set(run.results.map((r) => r.model).filter((m): m is string => !!m))].sort();
  const [saved] = await o.db.insert("golden_runs", {
    trigger: o.trigger,
    source: o.source,
    models,
    prompt_version: run.promptVersion,
    icp_version_id: icp.id,
    cases: s.cases,
    accuracy: s.accuracy,
    wrong_rate: s.wrongRate,
    verdict_agreement: s.verdictAgreement,
    spurious: s.spurious,
    tokens: s.tokens,
    status: s.status,
    reasons: s.reasons,
    detail: run.results,
  });
  return { ok: true, id: String(saved?.id ?? ""), run, icpVersion: icp.version };
}
