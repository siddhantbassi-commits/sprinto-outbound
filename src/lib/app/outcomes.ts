/**
 * What happened after a company was researched: the words for each outcome, which one a company is at now, and which
 * follow-ups are due. The newest row for a company is where it stands; the older rows are how it got there. Pure, so each
 * rule is tested.
 */

export type OutcomeId = "reached_out" | "replied" | "meeting_booked" | "not_interested" | "bounced" | "wrong_person";

export interface OutcomeDef {
  id: OutcomeId;
  label: string;
  help: string;
  tone: "info" | "good" | "warn" | "bad" | "muted";
  /** An open lead can have a follow-up date; a closed one cannot. */
  open: boolean;
}

export const OUTCOMES: OutcomeDef[] = [
  { id: "reached_out", label: "Reached out", help: "You have called, written or otherwise contacted them.", tone: "info", open: true },
  { id: "replied", label: "Replied", help: "They answered, whether or not it was a yes.", tone: "good", open: true },
  { id: "meeting_booked", label: "Meeting booked", help: "A discovery call is in the diary.", tone: "good", open: true },
  { id: "not_interested", label: "Not interested", help: "A clear no. You can also stop anyone writing to them again.", tone: "muted", open: false },
  { id: "bounced", label: "Bounced", help: "The address did not work.", tone: "warn", open: false },
  { id: "wrong_person", label: "Wrong person", help: "They are not the right contact at this company.", tone: "warn", open: false },
];

export const OUTCOME_BY_ID = Object.fromEntries(OUTCOMES.map((o) => [o.id, o])) as Record<OutcomeId, OutcomeDef>;
export const isOutcome = (s: string): s is OutcomeId => s in OUTCOME_BY_ID;

export interface OutcomeRow {
  prospect_id: string;
  seq: number | string;
  status: string;
  note: string;
  follow_up_on: string | Date | null;
  created_at: string | Date;
}

export interface Standing {
  status: OutcomeId;
  note: string;
  followUpOn: string | null;
  at: string;
}

/** A date column arrives as "2026-11-19" from Supabase and as a Date from some drivers; either way it is the calendar day written on it. */
const asDay = (v: string | Date | null): string | null => (v === null ? null : typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10));

/** Where each company stands now: its newest row. Rows with a status this code does not know are ignored rather than guessed at. */
export function standings(rows: OutcomeRow[]): Map<string, Standing> {
  const newest = new Map<string, OutcomeRow>();
  for (const r of rows) {
    if (!isOutcome(r.status)) continue;
    const have = newest.get(r.prospect_id);
    if (!have || Number(r.seq) > Number(have.seq)) newest.set(r.prospect_id, r);
  }
  return new Map([...newest].map(([id, r]) => [id, { status: r.status as OutcomeId, note: r.note, followUpOn: asDay(r.follow_up_on), at: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString() }]));
}

/** "2026-11-20" in the person's own day, so a follow-up due today is due, not tomorrow. */
export const dayOf = (d: Date | number): string => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export type FollowUp = { state: "overdue" | "today" | "upcoming"; on: string; days: number };

/** What a follow-up date means today. A closed lead has none, whatever an old row says. */
export function followUpOf(s: Standing | null | undefined, today: string): FollowUp | null {
  if (!s?.followUpOn || !OUTCOME_BY_ID[s.status].open) return null;
  const days = Math.round((Date.parse(`${s.followUpOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { state: days < 0 ? "overdue" : days === 0 ? "today" : "upcoming", on: s.followUpOn, days };
}

export const followUpText = (f: FollowUp): string =>
  f.state === "overdue" ? `Follow-up overdue by ${-f.days} ${f.days === -1 ? "day" : "days"}` : f.state === "today" ? "Follow up today" : `Follow up in ${f.days} ${f.days === 1 ? "day" : "days"}`;

export interface Summary {
  recorded: boolean;
  /** Companies with at least one outcome. */
  reached: number;
  replied: number;
  meetings: number;
  notInterested: number;
  bounced: number;
  wrongPerson: number;
}

/** Counts of companies that ever reached a stage, not of where they ended up, so a meeting that later went quiet still counts as a meeting. */
export function summarise(rows: OutcomeRow[]): Summary {
  const ever = (s: OutcomeId) => new Set(rows.filter((r) => r.status === s).map((r) => r.prospect_id)).size;
  const reached = new Set(rows.filter((r) => isOutcome(r.status)).map((r) => r.prospect_id)).size;
  return { recorded: reached > 0, reached, replied: ever("replied"), meetings: ever("meeting_booked"), notInterested: ever("not_interested"), bounced: ever("bounced"), wrongPerson: ever("wrong_person") };
}
