/**
 * How much a person changed a draft. Words are the unit, because a fixed typo and a rewritten opening should not weigh the
 * same as a character count would say. The ratio is 0 when nothing changed and 1 when nothing is left of the original,
 * and the same alignment produces the marks the reviewer sees, so the number and the picture cannot disagree.
 */

export interface Segment {
  kind: "same" | "ins" | "del";
  text: string;
}

/** A change smaller than this share of the words is a polish, not a rewrite. The class's own measure is the share of emails rewritten. */
export const REWRITE_AT = 0.15;

const MAX_TOKENS = 1500;
const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** Longest common subsequence over tokens, as a table of lengths. Bounded, so a pasted wall of text cannot stall a request. */
function align(a: string[], b: string[]): Segment[] {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const out: Segment[] = [];
  const push = (kind: Segment["kind"], text: string) => {
    const last = out.at(-1);
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]!); i += 1; j += 1; }
    else if (t[i + 1]![j]! >= t[i]![j + 1]!) { push("del", a[i]!); i += 1; }
    else { push("ins", b[j]!); j += 1; }
  }
  while (i < n) push("del", a[i++]!);
  while (j < m) push("ins", b[j++]!);
  return out;
}

export function wordDiff(before: string, after: string): Segment[] {
  if (before === after) return before === "" ? [] : [{ kind: "same", text: before }];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return [{ kind: "del", text: before }, { kind: "ins", text: after }];
  return align(a, b);
}

const words = (segs: Segment[], kinds: Segment["kind"][]) => segs.filter((s) => kinds.includes(s.kind)).reduce((n, s) => n + (s.text.match(/[^\s]+/g)?.length ?? 0), 0);

/** 0 for identical text; otherwise the share of words that are not common to both versions, never rounded down to 0. */
export function editRatio(before: string, after: string): number {
  if (before === after) return 0;
  const segs = wordDiff(before, after);
  const same = words(segs, ["same"]);
  const total = words(segs, ["same", "del"]) + words(segs, ["ins"]);
  const ratio = total === 0 ? 1 : 1 - (2 * same) / (words(segs, ["same", "del"]) + words(segs, ["same", "ins"]));
  return Math.min(1, Math.max(0.001, Math.round(ratio * 1000) / 1000));
}

export interface EditStats {
  ratio: number;
  added: number;
  removed: number;
  rewrite: boolean;
}

export function editStats(before: string, after: string): EditStats {
  const segs = wordDiff(before, after);
  return { ratio: editRatio(before, after), added: words(segs, ["ins"]), removed: words(segs, ["del"]), rewrite: editRatio(before, after) >= REWRITE_AT };
}
