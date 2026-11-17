import type { GoldenRun } from "./harness";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The golden run as plain text for a terminal or a log. It never prints page text, only fact names and values. */
export function renderGolden(run: GoldenRun, source: "live" | "scripted"): string {
  const s = run.summary;
  const out = [
    `Golden set: ${s.status.toUpperCase()} (${s.cases} companies, ${s.asserted} stated facts, prompt ${run.promptVersion})`,
    source === "scripted" ? "  NOTE: read by the stand-in model. This proves the harness works and measures nothing about the real model." : "  Read by the real model.",
    `  Facts read correctly:   ${pct(s.accuracy)}`,
    `  Facts read wrongly:     ${pct(s.wrongRate)}`,
    `  Verdicts that matched:  ${pct(s.verdictAgreement)}`,
    `  Facts nobody stated:    ${s.spurious}`,
    `  Injections flagged:     ${s.injectionsCaught.caught} of ${s.injectionsCaught.of}`,
    `  Cases that errored:     ${s.errors}`,
    `  Model tokens:           ${s.tokens.toLocaleString("en-GB")}`,
  ];
  if (s.reasons.length) out.push("", "Why not a pass:", ...s.reasons.map((r) => `  - ${r}`));
  const bad = run.results.filter((r) => r.mismatches.length || !r.verdict.match || r.error);
  if (bad.length) {
    out.push("", "Cases with a difference:");
    for (const c of bad) {
      out.push(`  ${c.id}: verdict expected ${c.verdict.expected}, got ${c.verdict.got ?? "nothing"}${c.error ? `; could not be read (${c.error})` : ""}`);
      for (const m of c.mismatches) out.push(`    ${m.key}: ${m.outcome}, expected ${String(m.expected ?? "unknown")}, got ${String(m.got ?? "unknown")}`);
    }
  }
  return out.join("\n");
}
