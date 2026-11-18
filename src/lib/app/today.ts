/**
 * What the Today screen shows: the few things that need a person this morning, worked out from rows already read. Each part
 * answers one question (what do I approve, who do I follow up, what is new, what is running) and says nothing it cannot back up.
 */

import { dayOf, followUpOf, type FollowUp } from "./outcomes";
import { isCallable, type Lead } from "./lead-types";
import { groupByStage, STAGES, type StageId } from "./stages";

export interface FollowUpItem {
  id: string;
  name: string;
  domain: string;
  contact: string | null;
  followUp: FollowUp;
}

/** Leads with a follow-up date, overdue first, then today, then soonest. Only those due by `within` days are listed. */
export function followUpsDue(leads: Lead[], now: number, within = 7): FollowUpItem[] {
  const today = dayOf(now);
  return leads
    .flatMap((l) => {
      const f = followUpOf(l.outcome, today);
      return f && f.days <= within ? [{ id: l.id, name: l.name, domain: l.domain, contact: l.contact?.name ?? null, followUp: f }] : [];
    })
    .sort((a, b) => a.followUp.days - b.followUp.days || a.name.localeCompare(b.name));
}

export interface StageCount {
  id: StageId;
  label: string;
  count: number;
}

export const pipelineCounts = (leads: Lead[]): StageCount[] => {
  const g = groupByStage(leads);
  return STAGES.map((s) => ({ id: s.id, label: s.label, count: g[s.id].length }));
};

/** The best leads not yet contacted, by score, for "who should I call first". */
export const nextToCall = (leads: Lead[], n = 3): Lead[] => leads.filter((l) => isCallable(l) && !l.outcome).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, n);

export const dateHeading = (now: number): string => new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
