/**
 * Lays researched companies out as dots along the 0 to 100 score line, stacking those that would overlap, so the whole pipeline can
 * be seen at once. Pure, so the placement is tested: dots never overlap unless more than `maxRows` rows would be needed (the cap keeps
 * the picture short, so a crowd beyond it shares rows), and the same scores always give the same picture.
 */

export interface SpreadLead {
  id: string;
  name: string;
  score: number | null;
  verdict: string | null;
}

export interface Dot extends SpreadLead {
  x: number;
  row: number;
}

export interface SpreadLayout {
  dots: Dot[];
  rows: number;
  /** Companies with no score yet, which have no place on the line. */
  unscored: number;
}

/** `width` is the line's length in the drawing's units, `gap` the least distance between two dots in the same row. */
export function spreadLeads(leads: SpreadLead[], width = 552, gap = 16, maxRows = 6): SpreadLayout {
  const scored = leads.filter((l): l is SpreadLead & { score: number } => l.score !== null && Number.isFinite(l.score));
  const sorted = [...scored].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const lastX: number[] = [];
  const dots: Dot[] = [];
  for (const l of sorted) {
    const x = (Math.max(0, Math.min(100, l.score)) / 100) * width;
    let row = lastX.findIndex((end) => x - end >= gap);
    if (row === -1) row = lastX.length < maxRows ? lastX.length : lastX.indexOf(Math.min(...lastX));
    lastX[row] = x;
    dots.push({ ...l, x, row });
  }
  return { dots, rows: Math.max(1, lastX.length), unscored: leads.length - scored.length };
}
