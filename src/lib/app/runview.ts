/**
 * What a run page shows, worked out from rows already read: how far along it is, how many companies have reached each
 * step, which to list, and what just happened. Pure, so every figure and sentence is tested. The page only draws it.
 */

import { ACTIONS, STEP_ORDER, STEPS } from "@/lib/app/format";

export interface RunProspect {
  id: string;
  domain: string;
  step: string;
  lane: string;
  lane_reason?: string | null;
  score?: number | null;
  verdict?: string | null;
}

/** Lanes where a person has to do something before the company can move on. */
export const NEEDS_PERSON = new Set(["review", "held", "unknown", "failed", "no_contact", "needs_more"]);

export interface Progress {
  total: number;
  /** Not being worked on any more: sent, skipped, or waiting for a person. */
  settled: number;
  active: number;
  needsPerson: number;
  sent: number;
  percent: number;
  /** Time so far while running; total time once finished. */
  elapsedMs: number;
  /** A rough guess at the time left, from the pace so far. Null until there is enough to go on. */
  etaMs: number | null;
}

export const MIN_FOR_ETA = 3;

/**
 * `lastStepAt` is when the newest step finished. Once nothing is active the clock stops there, so a finished run says how
 * long it took rather than counting on for as long as the page stays open.
 */
export function runProgress(prospects: RunProspect[], startedAt: string | Date, now: number, lastStepAt?: string | Date | null): Progress {
  const total = prospects.length;
  const active = prospects.filter((p) => p.lane === "active").length;
  const settled = total - active;
  const sent = prospects.filter((p) => p.lane === "sent").length;
  const needsPerson = prospects.filter((p) => NEEDS_PERSON.has(p.lane)).length;
  const start = new Date(startedAt).getTime();
  const end = active === 0 && lastStepAt ? Math.min(now, new Date(lastStepAt).getTime()) : now;
  const elapsedMs = Math.max(0, end - start);
  // Companies skipped before any work (suppressed, mailed recently) finish instantly and would flatter the pace.
  const worked = prospects.filter((p) => p.lane !== "active" && p.lane !== "skipped").length;
  const etaMs = active > 0 && worked >= MIN_FOR_ETA && elapsedMs > 0 ? Math.round((elapsedMs / worked) * active) : null;
  return { total, settled, active, needsPerson, sent, percent: total ? Math.round((settled / total) * 100) : 0, elapsedMs, etaMs };
}

export interface StageCount {
  step: string;
  label: string;
  /** Companies that have got at least this far. */
  reached: number;
  /** Of those, how many are sitting here with work still to come. */
  working: number;
  /** Of those, how many stopped here and need a person (or were ruled out). */
  stopped: number;
}

export function stageCounts(prospects: RunProspect[]): StageCount[] {
  return STEP_ORDER.map((step, i) => {
    const here = prospects.filter((p) => STEP_ORDER.indexOf(p.step) === i);
    return {
      step,
      label: STEPS[step] ?? step,
      reached: prospects.filter((p) => STEP_ORDER.indexOf(p.step) >= i).length,
      working: here.filter((p) => p.lane === "active").length,
      stopped: here.filter((p) => p.lane !== "active" && p.lane !== "sent").length,
    };
  });
}

export type Show = "all" | "active" | "needs" | "sent" | "stopped";
export const SHOWS: [Show, string][] = [["all", "All"], ["active", "In progress"], ["needs", "Need you"], ["sent", "Sent"], ["stopped", "Ruled out"]];

export const parseShow = (v: string | undefined): Show => (SHOWS.some(([k]) => k === v) ? (v as Show) : "all");

export function filterProspects<T extends RunProspect>(prospects: T[], show: Show): T[] {
  switch (show) {
    case "active": return prospects.filter((p) => p.lane === "active");
    case "needs": return prospects.filter((p) => NEEDS_PERSON.has(p.lane));
    case "sent": return prospects.filter((p) => p.lane === "sent");
    case "stopped": return prospects.filter((p) => p.lane !== "active" && p.lane !== "sent" && !NEEDS_PERSON.has(p.lane));
    default: return prospects;
  }
}

export type DotState = "done" | "now" | "stop" | "todo";

/** One dot per step, so a long list can be read at a glance: where each company is, and whether it is still moving. */
export function track(p: Pick<RunProspect, "step" | "lane">): DotState[] {
  const at = STEP_ORDER.indexOf(p.step);
  return STEP_ORDER.map((_, i) => {
    if (p.lane === "sent") return "done";
    if (i < at) return "done";
    if (i === at) return p.lane === "active" ? "now" : "stop";
    return "todo";
  });
}

export interface EventLite {
  id: number;
  prospect_id: string;
  step: string;
  status: string;
  created_at: string | Date;
}
export interface DecisionLite {
  prospect_id: string | null;
  kind: string;
  reason: string;
  created_at: string | Date;
}

export interface Activity {
  key: string;
  at: number;
  text: string;
  tone: "good" | "warn" | "bad" | "info";
  prospectId: string | null;
  domain: string | null;
}

const SUFFIX: Record<string, [string, Activity["tone"]]> = { ok: ["", "good"], parked: [" (waiting for a person)", "warn"], retry: [" (will try again)", "warn"], error: [" (failed)", "bad"], info: ["", "info"] };

/** The newest things that happened in the run, steps and people's decisions together, in plain words. */
export function activity(events: EventLite[], decisions: DecisionLite[], domainOf: Map<string, string>, limit = 12): Activity[] {
  const fromEvents: Activity[] = events.map((e) => {
    const [suffix, tone] = SUFFIX[e.status] ?? ["", "info" as const];
    return { key: `e${e.id}`, at: new Date(e.created_at).getTime(), text: `${ACTIONS[e.step] ?? e.step}${suffix}`, tone, prospectId: e.prospect_id, domain: domainOf.get(e.prospect_id) ?? null };
  });
  const fromDecisions: Activity[] = decisions.map((d, i) => ({
    key: `d${i}-${new Date(d.created_at).getTime()}`, at: new Date(d.created_at).getTime(), text: `A person: ${d.kind.replace(/_/g, " ")}${d.reason ? `, "${d.reason.slice(0, 80)}"` : ""}`,
    tone: "info" as const, prospectId: d.prospect_id, domain: d.prospect_id ? (domainOf.get(d.prospect_id) ?? null) : null,
  }));
  return [...fromEvents, ...fromDecisions].sort((a, b) => b.at - a.at).slice(0, limit);
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 10) return "a few seconds";
  if (s < 60) return `${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h} hours`;
}

/** One line for the top of the page. */
export function runHeadline(p: Progress, paused: boolean): string {
  if (p.total === 0) return "Nothing in this run.";
  if (paused) return `Paused with ${p.active} still to do. No new step will start until it is resumed.`;
  if (p.active > 0) return `Working: ${p.settled} of ${p.total} finished.`;
  if (p.needsPerson > 0) return `Finished by the system. ${p.needsPerson} ${p.needsPerson === 1 ? "company needs" : "companies need"} a person.`;
  return p.sent === p.total ? "Done: every company was sent." : "Done. Nothing is waiting on you.";
}
