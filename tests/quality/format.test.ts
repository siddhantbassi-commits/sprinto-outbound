import { describe, expect, it } from "vitest";
import { sampleNote, showDelta, showPrevious, showValue } from "@/lib/quality/format";
import type { Reading } from "@/lib/quality/live";

const r = (over: Partial<Reading>): Reading => ({ key: "k", label: "L", help: "", unit: "percent", value: 0.25, previous: 0.2, delta: 0.05, n: 50, minN: 20, noun: "checks", status: "good", why: "", ...over });

describe("showValue", () => {
  it("never shows a figure for a reading that cannot be judged, not even 0%", () => {
    expect(showValue(r({ status: "not_enough", value: 0 }))).toBe("Not enough data");
    expect(showValue(r({ status: "not_enough", value: 1 }))).toBe("Not enough data");
  });
  it("formats each unit", () => {
    expect(showValue(r({}))).toBe("25%");
    expect(showValue(r({ unit: "ms", value: 850 }))).toBe("850 ms");
    expect(showValue(r({ unit: "ms", value: 4200 }))).toBe("4.2 s");
    expect(showValue(r({ unit: "ms", value: 90_000 }))).toBe("1.5 min");
    expect(showValue(r({ unit: "tokens", value: 4800 }))).toBe("4.8k");
    expect(showValue(r({ unit: "tokens", value: 640 }))).toBe("640");
    expect(showValue(r({ unit: "minutes", value: 12 }))).toBe("12 min ago");
    expect(showValue(r({ unit: "minutes", value: 150 }))).toBe("2.5 h ago");
    expect(showValue(r({ unit: "count", value: 3 }))).toBe("3");
    expect(showValue(r({ unit: "text", value: null, text: "gemini-x · prompts p1" }))).toBe("gemini-x · prompts p1");
  });
  it("shows a dash when there is no value at all", () => expect(showValue(r({ value: null, status: "good" }))).toBe("-"));
});

describe("showPrevious and showDelta", () => {
  it("only compare when the comparison was fair", () => {
    expect(showPrevious(r({}))).toBe("20%");
    expect(showPrevious(r({ delta: null }))).toBe("-");
    expect(showPrevious(r({ previous: null }))).toBe("-");
    expect(showDelta(r({ delta: null }))).toBe("-");
  });
  it("shows percentage changes in points, with a real minus sign", () => {
    expect(showDelta(r({ delta: 0.08 }))).toBe("+8 points");
    expect(showDelta(r({ delta: -0.12 }))).toBe("−12 points");
    expect(showDelta(r({ delta: 0.001 }))).toBe("no change");
  });
  it("shows other units in their own terms", () => {
    expect(showDelta(r({ unit: "ms", delta: -1500 }))).toBe("−1.5 s");
    expect(showDelta(r({ unit: "tokens", delta: 2000 }))).toBe("+2.0k");
    expect(showDelta(r({ unit: "ms", delta: 0 }))).toBe("no change");
  });
});

describe("sampleNote", () => {
  it("for a reading that cannot be judged, says only how many it has and needs, once", () => {
    const note = sampleNote(r({ status: "not_enough", n: 4, minN: 10, why: "Only 4 sites tried; at least 10 are needed before this means anything." }));
    expect(note).toBe("Only 4 sites tried; at least 10 are needed before this means anything.");
  });
  it("for a judged reading, gives the sample then the reason", () => {
    expect(sampleNote(r({ n: 40, minN: 10, noun: "sites tried", why: "5% is below 20%." }))).toBe("40 sites tried · 5% is below 20%.");
  });
  it("for a reading with no sample, gives just the reason", () => expect(sampleNote(r({ minN: 0, n: 1, why: "None waiting." }))).toBe("None waiting."));
});
