/**
 * The shape of a lead and the one rule about it that the browser needs. Kept apart from the code that reads leads from the
 * database, because that code reaches modules that only run on a server, and the board and the filters run in the browser.
 */

import type { Standing } from "./outcomes";

export interface Lead {
  id: string;
  runId: string;
  domain: string;
  name: string;
  verdict: string | null;
  score: number | null;
  lane: string;
  updatedAt: string;
  reasons: string[];
  contact: { name: string; first: string | null; last: string | null; title: string | null; email: string | null } | null;
  pains: string[];
  emailStatus: string | null;
  /** Where it stands after outreach, from the newest recorded outcome. Null when nothing has been recorded. */
  outcome: Standing | null;
  /** The rubric found it already uses a competitor, which makes a call less likely to land. */
  usesCompetitor: boolean;
}

/** Leads worth calling: scored a strong or possible fit, and not already a clear no. Everything else stays under "All researched". */
export const isCallable = (l: Pick<Lead, "verdict" | "outcome">) => (l.verdict === "qualified" || l.verdict === "maybe") && l.outcome?.status !== "not_interested";
