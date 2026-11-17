import type { Reading, Status } from "./live";

/** How a reading's numbers read on the page. A reading that cannot be judged never shows a figure that looks like a result. */

const dur = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const one = (v: number, unit: Reading["unit"]): string => {
  switch (unit) {
    case "percent":
      return `${Math.round(v * 100)}%`;
    case "ms":
      return dur(v);
    case "tokens":
      return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
    case "minutes":
      return v < 90 ? `${Math.round(v)} min ago` : `${(v / 60).toFixed(1)} h ago`;
    default:
      return String(v);
  }
};

/** The figure for this week, or the words that say it cannot be judged. */
export function showValue(r: Reading): string {
  if (r.unit === "text") return r.text ?? "-";
  if (r.status === "not_enough") return "Not enough data";
  return r.value === null ? "-" : one(r.value, r.unit);
}

/** Last week's figure, only when it was big enough to compare against. */
export function showPrevious(r: Reading): string {
  if (r.unit === "text" || r.previous === null || r.delta === null) return "-";
  return one(r.previous, r.unit);
}

/** "+8 points", "-12%", or a dash when there is no fair comparison. */
export function showDelta(r: Reading): string {
  if (r.delta === null || r.unit === "text") return "-";
  if (r.unit === "percent") {
    const pts = Math.round(r.delta * 100);
    return pts === 0 ? "no change" : `${pts > 0 ? "+" : "−"}${Math.abs(pts)} points`;
  }
  if (r.delta === 0) return "no change";
  return `${r.delta > 0 ? "+" : "−"}${one(Math.abs(r.delta), r.unit)}`;
}

/**
 * The small print under a reading: how big the sample was and why it has its status. A reading that cannot be judged
 * already says how many it had and how many it needs, so that is all it shows.
 */
export const sampleNote = (r: Reading): string => (r.status === "not_enough" || r.minN === 0 ? r.why : [`${r.n} ${r.noun}`, r.why].join(" · "));

export const STATUS_LABEL: Record<Status, string> = { good: "Good", watch: "Watch", bad: "Act", info: "For information", not_enough: "Not enough data" };
export const STATUS_TONE: Record<Status, "good" | "warn" | "bad" | "info" | "muted"> = { good: "good", watch: "warn", bad: "bad", info: "info", not_enough: "muted" };
