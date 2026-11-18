import { estimateRun, stepSeconds, type RunEstimate } from "@/lib/app/progress";
import { NEEDS_PERSON } from "@/lib/app/runview";
import type { DbPort } from "@/lib/db/port";

export interface RunStatus extends RunEstimate {
  id: string;
  title: string;
  startedAt: string;
  /** When the newest step finished; for a finished run, roughly when it finished. */
  lastStepAt: string | null;
  sent: number;
  qualified: number;
  needsPerson: number;
  paused: boolean;
}

/**
 * The few newest runs with how far along each is, light enough to ask for every few seconds: two small reads per run, then
 * arithmetic. This is what the floating progress card and the notifications are driven by.
 */
export async function runStatuses(db: DbPort, limit = 5): Promise<RunStatus[]> {
  const runs = await db.select("runs", {}, { order: "created_at", ascending: false, limit, columns: "id,note,domain_count,created_at" });
  if (runs.length === 0) return [];
  const recent = await db.select("step_events", {}, { order: "id", ascending: false, limit: 200, columns: "step,status,latency_ms" });
  const seconds = stepSeconds(recent as unknown as { step: string; status: string; latency_ms: number | null }[]);
  const decisions = await db.select("decisions", {}, { order: "seq", ascending: false, limit: 100, columns: "run_id,kind" });
  return Promise.all(
    runs.map(async (r) => {
      const id = String(r.id);
      const ps = (await db.select("prospects", { run_id: id }, { columns: "step,lane,verdict,lease_until" })) as unknown as { step: string; lane: string; verdict: string | null; lease_until: string | null }[];
      const [last] = await db.select("step_events", { run_id: id }, { order: "id", ascending: false, limit: 1, columns: "created_at" });
      const lastPause = decisions.find((d) => String(d.run_id) === id && (d.kind === "pause_run" || d.kind === "resume_run"));
      const paused = lastPause?.kind === "pause_run";
      const now = Date.now();
      const est = estimateRun(ps.map((p) => ({ step: p.step, lane: p.lane, running: !!p.lease_until && new Date(p.lease_until).getTime() > now })), seconds);
      return {
        ...est,
        id,
        title: String(r.note || `Run of ${r.domain_count} ${Number(r.domain_count) === 1 ? "company" : "companies"}`),
        startedAt: String(r.created_at),
        lastStepAt: last ? String(last.created_at) : null,
        sent: ps.filter((p) => p.lane === "sent").length,
        qualified: ps.filter((p) => p.verdict === "qualified" || p.verdict === "maybe").length,
        needsPerson: ps.filter((p) => NEEDS_PERSON.has(p.lane)).length,
        paused,
      };
    }),
  );
}
