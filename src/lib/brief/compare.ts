/**
 * Two to four researched companies side by side. Everything here is read from the briefs the pages already show, so a comparison can
 * say nothing a single brief does not: it only lines them up, picks the strongest, and states in words where they differ.
 * Pure, so the ranking and the differences are tested.
 */

import type { Brief } from "./build";
import type { FwId, FrameworkRow } from "./intel";

export const MAX_COMPARE = 4;
export const MIN_COMPARE = 2;

export interface CompareInput {
  id: string;
  lane: string;
  brief: Brief;
}

export interface CompareColumn {
  id: string;
  name: string;
  domain: string;
  lane: string;
  verdict: string;
  verdictLabel: string;
  score: number | null;
  confidence: number;
  size: string | null;
  certification: string | null;
  stance: string;
  frameworks: Record<FwId, FrameworkRow>;
  contact: { name: string; title: string | null } | null;
  pains: string[];
  signals: number;
  usesCompetitor: boolean;
  /** Points short of a strong fit, or null when there is no gap to close (already strong, or not scored). */
  shortBy: number | null;
  emailStatus: string | null;
}

export interface Comparison {
  columns: CompareColumn[];
  /** The strongest fit: the highest score, with the better-evidenced brief winning a tie. Null when none is scored. */
  leader: { id: string; name: string; score: number } | null;
  bestScore: string[];
  bestEvidence: string[];
  verdictLine: string;
  differences: string[];
}

// [one company, several companies]: the verb has to agree with who is named.
const STATUS_WORD: Record<string, [string, string]> = { held: ["holds it", "hold it"], in_progress: ["has it in progress", "have it in progress"], likely: ["probably needs it", "probably need it"], not_indicated: ["shows no sign of needing it", "show no sign of needing it"] };
const FW_ORDER: FwId[] = ["soc2", "iso27001", "gdpr", "hipaa", "pci"];

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function buildComparison(items: CompareInput[]): Comparison {
  const columns: CompareColumn[] = items.slice(0, MAX_COMPARE).map(({ id, lane, brief: b }) => ({
    id,
    name: b.company.name,
    domain: b.company.domain,
    lane,
    verdict: b.fit.verdict,
    verdictLabel: b.fit.label,
    score: b.fit.score,
    confidence: b.intel.confidence.percent,
    size: b.company.size,
    certification: b.company.certification,
    stance: b.intel.stance.headline,
    frameworks: Object.fromEntries(b.intel.frameworks.map((f) => [f.id, f])) as Record<FwId, FrameworkRow>,
    contact: b.contact ? { name: b.contact.name, title: b.contact.title } : null,
    pains: b.talkingPoints.map((t) => t.label),
    signals: b.whyNow.length,
    usesCompetitor: Boolean(b.fit.usesCompetitor),
    shortBy: b.fit.verdict === "qualified" ? null : (b.intel.path.next?.points ?? null),
    emailStatus: b.email?.status ?? null,
  }));

  const scored = columns.filter((c): c is CompareColumn & { score: number } => c.score !== null);
  const ranked = [...scored].sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.name.localeCompare(b.name));
  const top = ranked[0] ?? null;
  const topScore = top?.score ?? null;
  const bestScore = topScore === null ? [] : scored.filter((c) => c.score === topScore).map((c) => c.id);
  const topEvidence = Math.max(0, ...columns.map((c) => c.confidence));
  const bestEvidence = columns.filter((c) => c.confidence === topEvidence && topEvidence > 0).map((c) => c.id);

  const second = ranked[1] ?? null;
  const verdictLine = !top
    ? "None of these has been scored yet, so there is nothing to rank."
    : second
      ? `${top.name} is the strongest fit at ${top.score}${second.score === top.score ? `, level with ${second.name}` : `, ${top.score - second.score} points ahead of ${second.name} (${second.score})`}.`
      : `${top.name} is the only one scored, at ${top.score}.`;

  const differences: string[] = [];
  for (const id of FW_ORDER) {
    const by = new Map<string, string[]>();
    for (const c of columns) by.set(c.frameworks[id].status, [...(by.get(c.frameworks[id].status) ?? []), c.name]);
    if (by.size < 2) continue;
    const name = columns[0]!.frameworks[id].name;
    const order = ["held", "in_progress", "likely", "not_indicated"];
    differences.push(`${name}: ${order.filter((s) => by.has(s)).map((s) => `${list(by.get(s)!)} ${STATUS_WORD[s]![by.get(s)!.length > 1 ? 1 : 0]}`).join("; ")}.`);
  }
  const noContact = columns.filter((c) => !c.contact).map((c) => c.name);
  if (noContact.length && noContact.length < columns.length) differences.push(`Contact: ${list(noContact)} ${noContact.length === 1 ? "has" : "have"} no named person yet; the others do.`);
  const rivals = columns.filter((c) => c.usesCompetitor).map((c) => c.name);
  if (rivals.length && rivals.length < columns.length) differences.push(`Competitor: ${list(rivals)} already ${rivals.length === 1 ? "seems" : "seem"} to use a rival tool, so expect a switching conversation there.`);
  const stances = new Set(columns.map((c) => c.stance));
  if (stances.size > 1) differences.push(`Conversation: ${columns.map((c) => `${c.name} is "${c.stance}"`).join("; ")}.`);

  return { columns, leader: top ? { id: top.id, name: top.name, score: top.score } : null, bestScore, bestEvidence, verdictLine, differences };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The companies named in a comparison link: valid ids only, no repeats, in the order given, and no more than four. */
export function parseCompareIds(raw: string | string[] | undefined): { ids: string[]; dropped: number } {
  const all = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).flatMap((r) => r.split(","));
  const valid = [...new Set(all.map((x) => x.trim().toLowerCase()).filter((x) => UUID.test(x)))];
  return { ids: valid.slice(0, MAX_COMPARE), dropped: Math.max(0, valid.length - MAX_COMPARE) };
}
