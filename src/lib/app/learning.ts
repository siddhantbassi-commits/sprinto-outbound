/**
 * What the outcomes say about the ICP. Once enough leads have been reached, which signals did the ones that replied or booked
 * a meeting have in common, and does a higher score really predict a better result? Pure, and deliberately cautious: it names
 * the sample behind every figure, shows nothing until there are enough outcomes to mean anything, and calls what it finds a
 * hypothesis to test (on the ICP and replay page, which can try a change without re-reading a site), never a rule.
 */

import { isOutcome, type OutcomeRow } from "./outcomes";

export interface LearnProspect {
  id: string;
  score: number | null;
  /** The rubric parts that earned points (or lost them), with their own ids and labels. */
  parts: { id: string; label: string; points: number }[];
}

/** Below this many companies reached, no pattern is shown: three replies out of five is not a finding. */
export const MIN_REACHED = 10;
/** A signal is compared only if at least this many reached companies had it and this many did not. */
export const MIN_GROUP = 3;
/** The gap, in percentage points, between "with" and "without" that is worth mentioning. */
export const NOTABLE_GAP = 20;
/** The score at which the ICP says a company qualifies. */
export const QUALIFIED_AT = 65;

export interface Funnel {
  reached: number;
  replied: number;
  meetings: number;
  /** Replied or booked a meeting: the result the comparisons are about. */
  positive: number;
}

export interface Insight {
  id: string;
  label: string;
  withN: number;
  withPositive: number;
  withoutN: number;
  withoutPositive: number;
  /** Positive rate with the signal minus without it, in percentage points. */
  gap: number;
  direction: "more" | "less";
  /** A suggestion about the weight, only when the sample is large enough to say anything. */
  suggestion: string | null;
}

export interface ScoreSplit {
  highN: number;
  highPositive: number;
  lowN: number;
  lowPositive: number;
  gap: number;
}

export interface Learning {
  funnel: Funnel;
  ready: boolean;
  needed: number;
  insights: Insight[];
  scoreSplit: ScoreSplit | null;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);

export function learnFromOutcomes(prospects: LearnProspect[], outcomes: OutcomeRow[]): Learning {
  const known = outcomes.filter((o) => isOutcome(o.status));
  const reachedIds = new Set(known.map((o) => o.prospect_id));
  const ever = (s: string) => new Set(known.filter((o) => o.status === s).map((o) => o.prospect_id));
  const replied = ever("replied");
  const meetings = ever("meeting_booked");
  const positive = new Set([...replied, ...meetings]);
  const byId = new Map(prospects.map((p) => [p.id, p]));
  const reached = [...reachedIds].map((id) => byId.get(id)).filter((p): p is LearnProspect => !!p);

  const funnel: Funnel = { reached: reached.length, replied: [...replied].filter((id) => byId.has(id)).length, meetings: [...meetings].filter((id) => byId.has(id)).length, positive: [...positive].filter((id) => byId.has(id)).length };
  const ready = reached.length >= MIN_REACHED;
  if (!ready) return { funnel, ready, needed: MIN_REACHED - reached.length, insights: [], scoreSplit: null };

  const labels = new Map<string, string>();
  for (const p of reached) for (const x of p.parts) if (x.points !== 0 && !labels.has(x.id)) labels.set(x.id, x.label.replace(/\s*\(.*\)\s*$/, ""));
  const insights: Insight[] = [];
  for (const [id, label] of labels) {
    const has = (p: LearnProspect) => p.parts.some((x) => x.id === id && x.points > 0);
    const w = reached.filter(has);
    const wo = reached.filter((p) => !has(p));
    if (w.length < MIN_GROUP || wo.length < MIN_GROUP) continue;
    const wp = w.filter((p) => positive.has(p.id)).length;
    const wop = wo.filter((p) => positive.has(p.id)).length;
    const gap = Math.round(pct(wp, w.length) - pct(wop, wo.length));
    if (Math.abs(gap) < NOTABLE_GAP) continue;
    const big = w.length >= 5 && wo.length >= 5;
    insights.push({
      id,
      label,
      withN: w.length,
      withPositive: wp,
      withoutN: wo.length,
      withoutPositive: wop,
      gap,
      direction: gap > 0 ? "more" : "less",
      suggestion: big ? (gap > 0 ? `Worth trying a higher weight for “${label}” on the ICP and replay page.` : `Worth trying a lower weight for “${label}” on the ICP and replay page.`) : null,
    });
  }
  insights.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.label.localeCompare(b.label));

  const high = reached.filter((p) => (p.score ?? 0) >= QUALIFIED_AT);
  const low = reached.filter((p) => (p.score ?? 0) < QUALIFIED_AT);
  const scoreSplit: ScoreSplit | null =
    high.length >= MIN_GROUP && low.length >= MIN_GROUP
      ? { highN: high.length, highPositive: high.filter((p) => positive.has(p.id)).length, lowN: low.length, lowPositive: low.filter((p) => positive.has(p.id)).length, gap: 0 }
      : null;
  if (scoreSplit) scoreSplit.gap = Math.round(pct(scoreSplit.highPositive, scoreSplit.highN) - pct(scoreSplit.lowPositive, scoreSplit.lowN));
  return { funnel, ready, needed: 0, insights, scoreSplit };
}

export const rateText = (n: number, of: number) => (of === 0 ? "no companies" : `${Math.round(pct(n, of))}% (${n} of ${of})`);
