/**
 * The kill-criteria scorecard. The class's rule for any build is to decide, before building, the point at which you shut it
 * down, and then to check it. For this case the Growth Lead's own thresholds are: stop if more than half of the emails are
 * rewritten, if running the system takes more time than it saves, or if the person chosen is the right one less than 60% of
 * the time. The aims are under 2 minutes of person time per company and fewer than 20% of emails rewritten.
 *
 * Everything is computed from decisions a person recorded on the Review desk and from the trace, by a pure function, so each
 * rule can be tested exactly. Two promises: a small sample is never shown as good news ("not enough data"), and conversion
 * is not claimed, because in test mode nobody was mailed.
 */

import { REWRITE_AT } from "@/lib/app/editdiff";
import type { Range } from "@/lib/app/impact";

/** Fewer decisions than this say nothing about a rate. The same floor the Quality page uses for its rates. */
export const MIN_DECIDED = 8;
export const KILL_REWRITE = 0.5;
export const AIM_REWRITE = 0.2;
export const KILL_CONTACT = 0.6;
/** Our own warning margin above the kill line, not the class's: close enough to the edge to look at before it is crossed. */
export const CONTACT_MARGIN = 0.1;
export const AIM_PERSON_MINUTES = 2;

export interface ReviewRow {
  action: "approve" | "reject";
  edit_ratio: number | string;
  contact_ok: boolean;
  created_at: string | Date;
  prospect_id?: string;
  reason?: string;
}

/** The time figures Impact already works out, passed in plainly so this module needs nothing from the database. */
export interface TimeFacts {
  researched: number;
  baselineMinutes: number;
  humanMinutes: number;
  machineMinutes: number;
  savedMinutes: number;
  manualMinutesPerCompany: number;
}

export type Status = "ok" | "watch" | "kill" | "unknown";

export interface Criterion {
  id: "rewrites" | "contacts" | "time";
  label: string;
  killRule: string;
  aim: string | null;
  status: Status;
  /** Rewrite rate and contact accuracy as 0 to 1; minutes saved for time. Null when it cannot be said. */
  value: number | null;
  display: string;
  sample: number;
  /** How many more decisions are needed before this can be judged. */
  needed: number;
  working: string;
}

export interface Scorecard {
  criteria: Criterion[];
  personMinutesPerCompany: number | null;
  machineMinutesPerCompany: number | null;
  verdict: "stop" | "insufficient" | "watch" | "continue";
  headline: string;
  decided: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mins = (m: number) => (Math.abs(m) >= 90 ? `${Math.round((m / 60) * 10) / 10} hours` : `${Math.round(m)} minutes`);
const at = (d: string | Date) => new Date(d).getTime();
const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function inRange(reviews: ReviewRow[], range: Range): ReviewRow[] {
  return reviews.filter((r) => (range.from === null || at(r.created_at) >= range.from) && at(r.created_at) <= range.to);
}

/** A draft counts as rewritten if a person rejected it, or changed at least REWRITE_AT of its words before approving. */
export const isRewrite = (r: ReviewRow) => r.action === "reject" || num(r.edit_ratio) >= REWRITE_AT;

export function computeScorecard(input: { reviews: ReviewRow[]; time: TimeFacts }): Scorecard {
  const { reviews: rows, time } = input;
  const n = rows.length;
  const needed = Math.max(0, MIN_DECIDED - n);

  const rejected = rows.filter((r) => r.action === "reject").length;
  const edited = rows.filter((r) => r.action === "approve" && num(r.edit_ratio) >= REWRITE_AT).length;
  const rewrites = rejected + edited;
  const rewriteRate = n > 0 ? rewrites / n : null;
  const rewriteStatus: Status = n < MIN_DECIDED || rewriteRate === null ? "unknown" : rewriteRate > KILL_REWRITE ? "kill" : rewriteRate >= AIM_REWRITE ? "watch" : "ok";

  const wrong = rows.filter((r) => !r.contact_ok).length;
  const accuracy = n > 0 ? (n - wrong) / n : null;
  const contactStatus: Status = n < MIN_DECIDED || accuracy === null ? "unknown" : accuracy < KILL_CONTACT ? "kill" : accuracy < KILL_CONTACT + CONTACT_MARGIN ? "watch" : "ok";

  const companies = time.researched;
  const timeNeeded = Math.max(0, MIN_DECIDED - companies);
  const person = companies > 0 ? time.humanMinutes / companies : null;
  const machine = companies > 0 ? time.machineMinutes / companies : null;
  const timeStatus: Status = companies < MIN_DECIDED ? "unknown" : time.savedMinutes < 0 ? "kill" : person !== null && person > AIM_PERSON_MINUTES ? "watch" : "ok";

  const criteria: Criterion[] = [
    {
      id: "rewrites", label: "Emails rewritten", killRule: "Stop if more than 50% of emails are rewritten.", aim: "Aim for under 20%.",
      status: rewriteStatus, value: rewriteRate, display: rewriteRate === null ? "-" : pct(rewriteRate), sample: n, needed,
      working: n === 0 ? "No draft has been decided yet." : `${rewrites} of ${n} ${n === 1 ? "draft was" : "drafts were"} rewritten: ${rejected} rejected, and ${edited} approved after changing ${pct(REWRITE_AT)} or more of the words.`,
    },
    {
      id: "contacts", label: "Right person chosen", killRule: "Stop if the contact is right less than 60% of the time.", aim: null,
      status: contactStatus, value: accuracy, display: accuracy === null ? "-" : pct(accuracy), sample: n, needed,
      working: n === 0 ? "No draft has been decided yet." : `${n - wrong} of ${n} ${n === 1 ? "draft" : "drafts"} went to the right person. ${wrong} ${wrong === 1 ? "was" : "were"} rejected because the contact was wrong.`,
    },
    {
      id: "time", label: "Time saved", killRule: "Stop if running it takes more time than it saves.", aim: `Aim for under ${AIM_PERSON_MINUTES} minutes of person time per company.`,
      status: timeStatus, value: companies > 0 ? time.savedMinutes : null, display: companies > 0 ? (time.savedMinutes < 0 ? `${mins(-time.savedMinutes)} lost` : mins(time.savedMinutes)) : "-", sample: companies, needed: timeNeeded,
      working: companies === 0 ? "No company has been researched yet." : `By hand: ${time.manualMinutesPerCompany} minutes × ${companies} = ${mins(time.baselineMinutes)}. With the system: ${mins(time.humanMinutes)} of person time (${person === null ? "-" : person.toFixed(1)} minutes a company). An estimate from the assumptions in Settings, not a stopwatch.`,
    },
  ];

  const killed = criteria.filter((c) => c.status === "kill");
  const unknown = criteria.filter((c) => c.status === "unknown");
  const watching = criteria.filter((c) => c.status === "watch");
  let verdict: Scorecard["verdict"];
  let headline: string;
  if (killed.length) {
    verdict = "stop";
    headline = `Stop and decide: ${join(killed.map((c) => c.label.toLowerCase()))} ${killed.length === 1 ? "has" : "have"} crossed ${killed.length === 1 ? "its" : "their"} kill line.`;
  } else if (unknown.length) {
    verdict = "insufficient";
    const most = Math.max(...unknown.map((c) => c.needed));
    headline = `Not enough data yet to call it. ${most} more ${most === 1 ? "decision" : "decisions"} needed. Nothing has crossed a kill line so far.`;
  } else if (watching.length) {
    verdict = "watch";
    headline = `Keep going, and watch: ${join(watching.map((c) => c.label.toLowerCase()))} ${watching.length === 1 ? "needs" : "need"} a closer look.`;
  } else {
    verdict = "continue";
    headline = "Keep going: every criterion is inside its limit and on aim.";
  }
  return { criteria, personMinutesPerCompany: person, machineMinutesPerCompany: machine, verdict, headline, decided: n };
}

/**
 * Made-up decisions, for the demo's preview of how the scorecard reads when things go well, so-so or badly. Never real data.
 * `edited` drafts were approved after a large change; `wrong` drafts were rejected for the wrong contact (which also counts
 * as a rewrite); the rest were approved with a small polish or none.
 */
export function sampleScenario(kind: "healthy" | "watch" | "kill", now: number): { reviews: ReviewRow[]; time: TimeFacts } {
  const shape = {
    healthy: { edited: 2, wrong: 1, savedMinutes: 330, humanMinutes: 38 },
    watch: { edited: 1, wrong: 7, savedMinutes: 150, humanMinutes: 96 },
    kill: { edited: 2, wrong: 10, savedMinutes: -25, humanMinutes: 425 },
  }[kind];
  const total = 20;
  const reviews: ReviewRow[] = Array.from({ length: total }, (_, i) => {
    const wrong = i >= total - shape.wrong;
    const edited = !wrong && i < shape.edited;
    return {
      action: wrong ? "reject" : "approve",
      edit_ratio: wrong ? 0 : edited ? 0.3 : i % 2 ? 0.04 : 0,
      contact_ok: !wrong,
      created_at: new Date(now - i * 3_600_000).toISOString(),
    };
  });
  return { reviews, time: { researched: total, baselineMinutes: total * 20, humanMinutes: shape.humanMinutes, machineMinutes: 14, savedMinutes: shape.savedMinutes, manualMinutesPerCompany: 20 } };
}
