/**
 * How far along a run really is, and about how long is left. Not a guess at a percentage: each company is at a known step,
 * each step has a known typical duration (measured from real runs, then refined from this system's own recent steps), and
 * the worker takes one step at a time, so the time left is the sum of the steps still to do. A company that has stopped
 * (not a fit, no contact, waiting for a person) counts as done, because nothing more will happen to it without a person.
 * Pure, so every figure is tested.
 */

/** The steps in the order they run, by the step a company is waiting at. */
export const WORK_STEPS = ["queued", "scraped", "qualified", "contact_found", "pains_chosen", "drafted"] as const;
export type WorkStep = (typeof WORK_STEPS)[number];

/** Typical seconds each step takes, measured on real companies. The worker's default until it has seen enough of its own. */
export const DEFAULT_SECONDS: Record<WorkStep, number> = { queued: 10, scraped: 15, qualified: 3, contact_found: 7, pains_chosen: 15, drafted: 2 };

/** The step event names the database records, mapped to the step a company waits at when that work is next. */
const EVENT_TO_STEP: Record<string, WorkStep> = { scrape: "queued", qualify: "scraped", contact: "qualified", pains: "contact_found", draft: "pains_chosen", send: "drafted" };

/** What is happening to a company waiting at each step, in words. */
export const DOING: Record<WorkStep, string> = {
  queued: "Reading the websites",
  scraped: "Judging fit against your ICP",
  qualified: "Finding the right person",
  contact_found: "Choosing what to say",
  pains_chosen: "Writing the emails",
  drafted: "Handing over for approval",
};

export const MIN_SAMPLES = 3;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Typical seconds per step from recent finished steps. Needs a few samples of a step before it overrides the default, and
 * ignores a single freak value (a model that took 40 seconds once) by using the median, then clamping to a sensible range.
 */
export function stepSeconds(events: { step: string; status: string; latency_ms: number | null }[]): Record<WorkStep, number> {
  const out = { ...DEFAULT_SECONDS };
  const by = new Map<WorkStep, number[]>();
  for (const e of events) {
    const step = EVENT_TO_STEP[e.step];
    if (!step || e.status !== "ok" || e.latency_ms === null || e.latency_ms <= 0) continue;
    by.set(step, [...(by.get(step) ?? []), e.latency_ms / 1000]);
  }
  for (const [step, xs] of by) {
    if (xs.length < MIN_SAMPLES) continue;
    const def = DEFAULT_SECONDS[step];
    out[step] = Math.min(def * 4, Math.max(def / 4, median(xs)));
  }
  return out;
}

export interface ProgressInput {
  step: string;
  lane: string;
}

export interface RunEstimate {
  total: number;
  /** 0 to 100, from the work done, not from the count of finished companies. */
  percent: number;
  remainingSeconds: number | null;
  /** What most of the waiting companies are doing now, or null when nothing is running. */
  doing: string | null;
  /** The step index (0 to 5) of the furthest-behind waiting company, for the stage dots. */
  stageIndex: number | null;
  active: number;
  finished: boolean;
}

const idx = (step: string) => Math.max(0, WORK_STEPS.indexOf(step as WorkStep));

export function estimateRun(prospects: ProgressInput[], seconds: Record<WorkStep, number> = DEFAULT_SECONDS): RunEstimate {
  const total = prospects.length;
  const per = WORK_STEPS.reduce((n, s) => n + seconds[s], 0);
  let done = 0;
  let remaining = 0;
  const waiting: number[] = [];
  for (const p of prospects) {
    if (p.lane !== "active") {
      done += per;
      continue;
    }
    const i = idx(p.step);
    const left = WORK_STEPS.slice(i).reduce((n, s) => n + seconds[s], 0);
    done += per - left;
    remaining += left;
    waiting.push(i);
  }
  const active = waiting.length;
  const percent = total === 0 || per === 0 ? 100 : Math.min(100, Math.floor((done / (per * total)) * 100));
  // The most common step among those waiting says what the worker is mostly doing; ties go to the earlier step.
  const counts = new Map<number, number>();
  for (const i of waiting) counts.set(i, (counts.get(i) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  return {
    total,
    percent: active === 0 ? 100 : Math.min(99, percent),
    remainingSeconds: active === 0 ? null : Math.round(remaining),
    doing: common === undefined ? null : DOING[WORK_STEPS[common]!],
    stageIndex: waiting.length ? Math.min(...waiting) : null,
    active,
    finished: active === 0,
  };
}

/** "about 3 minutes", "under a minute", "about 1 hour 20 minutes": rounded the way a person would say it, never falsely exact. */
export function roughTime(seconds: number): string {
  if (seconds < 45) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `about ${h} ${h === 1 ? "hour" : "hours"}${m >= 10 ? ` ${Math.round(m / 5) * 5} minutes` : ""}`;
}
