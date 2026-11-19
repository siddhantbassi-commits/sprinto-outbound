import { describe, expect, it } from "vitest";
import { spreadLeads, type SpreadLead } from "@/lib/app/spread";

const lead = (id: string, score: number | null, name = id): SpreadLead => ({ id, name, score, verdict: score === null ? null : "maybe" });

describe("laying companies out along the score line", () => {
  it("puts each company at its score, from 0 to the width", () => {
    const l = spreadLeads([lead("a", 0), lead("b", 50), lead("c", 100)], 500);
    expect(l.dots.map((d) => d.x)).toEqual([0, 250, 500]);
    expect(l.rows).toBe(1);
  });

  it("stacks companies with nearly the same score so no two dots overlap", () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead(`c${i}`, 60 + (i % 3)));
    const l = spreadLeads(leads, 552, 16, 20);
    for (const a of l.dots) for (const b of l.dots) if (a !== b && a.row === b.row) expect(Math.abs(a.x - b.x), `${a.id} and ${b.id}`).toBeGreaterThanOrEqual(16);
    expect(l.rows).toBeGreaterThan(1);
  });

  it("keeps the picture within a few rows, however crowded", () => {
    const leads = Array.from({ length: 60 }, (_, i) => lead(`c${i}`, 50));
    const l = spreadLeads(leads, 552, 16, 6);
    expect(l.rows).toBeLessThanOrEqual(6);
    expect(l.dots).toHaveLength(60);
    expect(Math.max(...l.dots.map((d) => d.row))).toBeLessThanOrEqual(5);
  });

  it("gives the same picture for the same scores, whatever order they arrive in", () => {
    const a = [lead("x", 70), lead("y", 70), lead("z", 20)];
    expect(spreadLeads([...a].reverse())).toEqual(spreadLeads(a));
  });

  it("counts companies with no score instead of drawing them, and clamps odd scores onto the line", () => {
    const l = spreadLeads([lead("a", null), lead("b", 140), lead("c", -5), { id: "d", name: "d", score: Number.NaN, verdict: null }], 100);
    expect(l.unscored).toBe(2);
    expect(l.dots.map((d) => d.x).sort((p, q) => p - q)).toEqual([0, 100]);
  });

  it("handles nothing at all", () => {
    expect(spreadLeads([])).toEqual({ dots: [], rows: 1, unscored: 0 });
  });
});
