/**
 * Finding leads: the search box, the filters and the sort on the Leads page, as a plain query that lives in the address (so a
 * view can be bookmarked, shared and saved) and one pure function that applies it. Anything in the address it does not
 * recognise is ignored, so a hand-edited link cannot break the page.
 */

import type { Lead } from "./lead-types";
import { isCallable } from "./lead-types";
import { dayOf, followUpOf, isOutcome, OUTCOME_BY_ID, type OutcomeId } from "./outcomes";
import { stageOf, type StageId } from "./stages";

export type LeadView = "worth" | "follow" | "all" | "board";
export type LeadSort = "fit" | "name" | "follow" | "recent";
export type VerdictFilter = "any" | "qualified" | "maybe" | "not_fit" | "needs_more";
export type OutcomeFilter = "any" | "none" | OutcomeId;

export interface LeadQuery {
  view: LeadView;
  q: string;
  verdict: VerdictFilter;
  outcome: OutcomeFilter;
  sort: LeadSort;
  /** Leave out companies the rubric found already use a competitor. */
  skipCompetitor: boolean;
}

export const DEFAULT_QUERY: LeadQuery = { view: "worth", q: "", verdict: "any", outcome: "any", sort: "fit", skipCompetitor: false };

const VIEWS: LeadView[] = ["worth", "follow", "all", "board"];
const SORTS: LeadSort[] = ["fit", "name", "follow", "recent"];
const VERDICTS: VerdictFilter[] = ["any", "qualified", "maybe", "not_fit", "needs_more"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseLeadQuery(params: Record<string, string | string[] | undefined>): LeadQuery {
  const view = one(params.view);
  const legacy = one(params.show); // the first version of the page used ?show=all and ?show=follow
  const v = (VIEWS as string[]).includes(view) ? (view as LeadView) : legacy === "all" ? "all" : legacy === "follow" ? "follow" : DEFAULT_QUERY.view;
  const sort = one(params.sort);
  const verdict = one(params.verdict);
  const outcome = one(params.outcome);
  return {
    view: v,
    q: one(params.q).trim().slice(0, 80),
    verdict: (VERDICTS as string[]).includes(verdict) ? (verdict as VerdictFilter) : "any",
    outcome: outcome === "none" || isOutcome(outcome) ? (outcome as OutcomeFilter) : "any",
    sort: (SORTS as string[]).includes(sort) ? (sort as LeadSort) : defaultSort(v),
    skipCompetitor: one(params.skip) === "competitor",
  };
}

const defaultSort = (v: LeadView): LeadSort => (v === "follow" ? "follow" : "fit");

/** The query as an address, leaving out everything that is just the default, so links stay short and a saved view is stable. */
export function toSearch(q: LeadQuery): string {
  const p = new URLSearchParams();
  if (q.view !== DEFAULT_QUERY.view) p.set("view", q.view);
  if (q.q) p.set("q", q.q);
  if (q.verdict !== "any") p.set("verdict", q.verdict);
  if (q.outcome !== "any") p.set("outcome", q.outcome);
  if (q.sort !== defaultSort(q.view)) p.set("sort", q.sort);
  if (q.skipCompetitor) p.set("skip", "competitor");
  const s = p.toString();
  return s ? `?${s}` : "";
}

const hay = (l: Lead) => `${l.name} ${l.domain} ${l.contact?.name ?? ""} ${l.contact?.title ?? ""} ${l.pains.join(" ")} ${l.reasons.join(" ")}`.toLowerCase();

/** Applies a query to the leads: which view, which filters, in what order. Does not change the input. */
export function applyLeadQuery(leads: Lead[], q: LeadQuery, now: number): Lead[] {
  const today = dayOf(now);
  const words = q.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = leads.filter((l) => {
    if (q.view === "worth" && !isCallable(l)) return false;
    if (q.view === "follow" && followUpOf(l.outcome, today) === null) return false;
    // The board shows every lead that is in a stage; "all researched" shows everything, even what is in no stage.
    if (q.view === "board" && stageOf(l) === null) return false;
    if (q.verdict !== "any" && (l.verdict ?? "needs_more") !== q.verdict) return false;
    if (q.outcome === "none" ? l.outcome !== null : q.outcome !== "any" && l.outcome?.status !== q.outcome) return false;
    if (q.skipCompetitor && l.usesCompetitor) return false;
    if (words.length && !words.every((w) => hay(l).includes(w))) return false;
    return true;
  });
  const follow = (l: Lead) => followUpOf(l.outcome, today)?.days ?? Number.POSITIVE_INFINITY;
  const by: Record<LeadSort, (a: Lead, b: Lead) => number> = {
    fit: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    follow: (a, b) => follow(a) - follow(b) || (b.score ?? -1) - (a.score ?? -1),
    recent: (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0),
  };
  return [...out].sort(by[q.sort]);
}

/** A short description of the active filters, for a "no leads match" message and for naming a saved view. */
export function describeQuery(q: LeadQuery): string {
  const bits: string[] = [];
  if (q.q) bits.push(`“${q.q}”`);
  if (q.verdict !== "any") bits.push(q.verdict.replace("_", " "));
  if (q.outcome === "none") bits.push("nothing recorded");
  else if (q.outcome !== "any") bits.push(OUTCOME_BY_ID[q.outcome].label.toLowerCase());
  if (q.skipCompetitor) bits.push("no competitor");
  return bits.join(", ");
}

export const isFiltered = (q: LeadQuery) => q.q !== "" || q.verdict !== "any" || q.outcome !== "any" || q.skipCompetitor;
export type { StageId };
