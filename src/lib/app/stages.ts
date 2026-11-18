/**
 * Where each lead stands in the pursuit, in the words a person uses: To contact, Reached out, Replied, Meeting booked, and the
 * ways it can end. One definition, used by the Today screen's pipeline strip and by the Leads board, so they cannot disagree.
 * A lead is "to contact" only while it is worth a call and nothing has been recorded; once an outcome is recorded, the newest
 * outcome is its stage whatever its score. Pure, so it is tested.
 */

import type { Lead } from "./lead-types";
import { isCallable } from "./lead-types";
import { OUTCOMES, type OutcomeId } from "./outcomes";

export type StageId = "to_contact" | OutcomeId;

export interface StageDef {
  id: StageId;
  label: string;
  help: string;
  /** Closed stages end the pursuit; a card cannot be moved out of one by dragging, only by recording a new outcome. */
  closed: boolean;
}

export const STAGES: StageDef[] = [
  { id: "to_contact", label: "To contact", help: "Worth a call, nothing recorded yet.", closed: false },
  ...OUTCOMES.map((o) => ({ id: o.id as StageId, label: o.label, help: o.help, closed: !o.open })),
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, StageDef>;

/** The stage a lead is in, or null when it is neither worth a call nor has anything recorded (it stays under "All researched"). */
export function stageOf(l: Pick<Lead, "outcome" | "verdict">): StageId | null {
  if (l.outcome) return l.outcome.status;
  return isCallable(l as Lead) ? "to_contact" : null;
}

export function groupByStage<T extends Pick<Lead, "outcome" | "verdict">>(leads: T[]): Record<StageId, T[]> {
  const out = Object.fromEntries(STAGES.map((s) => [s.id, [] as T[]])) as Record<StageId, T[]>;
  for (const l of leads) {
    const s = stageOf(l);
    if (s) out[s].push(l);
  }
  return out;
}

/** Whether a card may be moved to this stage by dragging: any recordable outcome, never back to "to contact", which is not an outcome. */
export const canMoveTo = (to: StageId): to is OutcomeId => to !== "to_contact";
