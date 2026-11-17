import { isExcludedDomain } from "./blocklist";
import type { IcpConfig } from "./config";
import { scoreIcp } from "./score";
import type { Facts, ScoreResult, Verdict } from "./types";

/**
 * Replay: re-score every stored company under a draft ICP, from the facts already extracted, without fetching anything
 * and without saving anything. It answers "if I defined fit this way, who would move?" before anyone commits to it.
 *
 * It checks itself first. Replaying the CURRENT version over the stored facts must reproduce the verdicts that were
 * recorded at the time; if it does not, something other than the weights has changed (a blocklist, a suppression), and
 * the result says how many did not match so the comparison is not trusted blindly.
 */

export interface Subject {
  id: string;
  domain: string;
  /** What was recorded when the company was first scored. */
  stored: { verdict: Verdict | null; score: number | null; /** The ICP version that produced it, if known. */ version?: number | null };
  facts: Facts;
  /** Characters and pages read, as recorded by the qualify step. Null for rows written before that was recorded. */
  textChars: number | null;
  pages: number | null;
  suppressed: boolean;
}

export interface Side {
  config: IcpConfig;
  blocklist: string[];
}

export interface PartDelta {
  label: string;
  from: number;
  to: number;
}

export type MoveKind = "now_qualifies" | "no_longer_qualifies" | "other";

export interface Mover {
  id: string;
  domain: string;
  from: { verdict: Verdict; score: number };
  to: { verdict: Verdict; score: number };
  kind: MoveKind;
  reason: string;
  /** The parts whose points changed most, which is the "why" of the move. */
  because: PartDelta[];
}

export interface ReplayResult {
  total: number;
  /** How many companies the current version reproduces exactly, as a sanity check on the comparison. */
  reproduces: { matching: number; of: number; /** Of those that differ: scored under an older version (expected after a change). */ olderVersion: number; /** Of those that differ: for some other reason, such as a suppression or blocklist added since. */ other: number };
  /** Count of companies by verdict under the base, then under the draft. */
  matrix: Record<string, Record<string, number>>;
  movers: Mover[];
  /** Same verdict, different score. */
  scoreOnly: number;
  unchanged: number;
  /** Companies whose pages-read figures were not recorded, so the reading-enough gate was assumed to pass. */
  approximated: number;
  counts: { base: Record<string, number>; draft: Record<string, number> };
}

const VERDICTS: Verdict[] = ["qualified", "maybe", "needs_more", "not_fit"];

function run(s: Subject, side: Side, assume: { chars: number; pages: number }): ScoreResult {
  return scoreIcp(s.facts, { excludedDomain: isExcludedDomain(s.domain, side.blocklist), suppressed: s.suppressed, textChars: s.textChars ?? assume.chars, pages: s.pages ?? assume.pages }, side.config);
}

const kindOf = (from: Verdict, to: Verdict): MoveKind => (to === "qualified" ? "now_qualifies" : from === "qualified" ? "no_longer_qualifies" : "other");

function deltas(a: ScoreResult, b: ScoreResult): PartDelta[] {
  const before = new Map(a.parts.map((p) => [p.id, p]));
  return b.parts
    .map((p) => ({ label: p.label, from: before.get(p.id)?.points ?? 0, to: p.points }))
    .filter((d) => d.from !== d.to)
    .sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from))
    .slice(0, 3);
}

export function replay(subjects: Subject[], base: Side, draft: Side): ReplayResult {
  const matrix: ReplayResult["matrix"] = Object.fromEntries(VERDICTS.map((v) => [v, Object.fromEntries(VERDICTS.map((w) => [w, 0]))]));
  const counts = { base: Object.fromEntries(VERDICTS.map((v) => [v, 0])), draft: Object.fromEntries(VERDICTS.map((v) => [v, 0])) } as ReplayResult["counts"];
  const movers: Mover[] = [];
  let matching = 0;
  let olderVersion = 0;
  let other = 0;
  let scoreOnly = 0;
  let unchanged = 0;
  let approximated = 0;

  for (const s of subjects) {
    if (s.textChars === null || s.pages === null) approximated += 1;
    const a = run(s, base, { chars: base.config.minChars, pages: base.config.minPages });
    const b = run(s, draft, { chars: draft.config.minChars, pages: draft.config.minPages });
    if (s.stored.verdict === a.verdict && s.stored.score === Math.round(a.score)) matching += 1;
    else if (s.stored.version != null && s.stored.version !== base.config.version) olderVersion += 1;
    else other += 1;
    (matrix[a.verdict] as Record<string, number>)[b.verdict] = ((matrix[a.verdict] as Record<string, number>)[b.verdict] ?? 0) + 1;
    counts.base[a.verdict] = (counts.base[a.verdict] ?? 0) + 1;
    counts.draft[b.verdict] = (counts.draft[b.verdict] ?? 0) + 1;

    if (a.verdict !== b.verdict) {
      movers.push({ id: s.id, domain: s.domain, from: { verdict: a.verdict, score: a.score }, to: { verdict: b.verdict, score: b.score }, kind: kindOf(a.verdict, b.verdict), reason: b.reason, because: deltas(a, b) });
    } else if (a.score !== b.score) scoreOnly += 1;
    else unchanged += 1;
  }

  // The ones that now qualify come first, then the ones that no longer do, then everything else; each by domain.
  const order: Record<MoveKind, number> = { now_qualifies: 0, no_longer_qualifies: 1, other: 2 };
  movers.sort((x, y) => order[x.kind] - order[y.kind] || x.domain.localeCompare(y.domain));
  return { total: subjects.length, reproduces: { matching, of: subjects.length, olderVersion, other }, matrix, movers, scoreOnly, unchanged, approximated, counts };
}
