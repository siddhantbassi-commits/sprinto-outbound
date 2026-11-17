import { describe, expect, it } from "vitest";
import { editRatio, editStats, REWRITE_AT, wordDiff } from "@/lib/app/editdiff";

const BODY = "Hi Priya, I noticed Northwind is working toward SOC 2 this year. Teams at that stage often lose weeks to security questionnaires. Would a short call next week be useful? Alex";

describe("wordDiff", () => {
  it("reports unchanged text as one unchanged piece", () => expect(wordDiff("a b c", "a b c")).toEqual([{ kind: "same", text: "a b c" }]));
  it("marks an inserted and a removed word where they are", () => {
    expect(wordDiff("the quick fox", "the slow fox").map((s) => `${s.kind}:${s.text.trim()}`).filter((x) => !x.endsWith(":"))).toEqual(["same:the", "del:quick", "ins:slow", "same:fox"]);
  });
  it("puts back together exactly: the unchanged and removed pieces give the original, and the unchanged and inserted give the new text", () => {
    const after = "Hi Priya, I saw Northwind is heading toward SOC 2. Teams at that stage often lose weeks to questionnaires. Could we talk next week? Alex";
    const segs = wordDiff(BODY, after);
    expect(segs.filter((s) => s.kind !== "ins").map((s) => s.text).join("")).toBe(BODY);
    expect(segs.filter((s) => s.kind !== "del").map((s) => s.text).join("")).toBe(after);
  });
  it("handles empty text on either side", () => {
    expect(wordDiff("", "")).toEqual([]);
    expect(wordDiff("", "new")).toEqual([{ kind: "ins", text: "new" }]);
    expect(wordDiff("old", "")).toEqual([{ kind: "del", text: "old" }]);
  });
  it("does not stall on a huge paste: it falls back to replacing the whole text", () => {
    const big = "word ".repeat(2000);
    expect(wordDiff(big, `${big}x`)).toEqual([{ kind: "del", text: big }, { kind: "ins", text: `${big}x` }]);
  });
});

describe("editRatio", () => {
  it("is exactly 0 for identical text", () => expect(editRatio(BODY, BODY)).toBe(0));
  it("is never 0 when anything changed, even a single comma", () => expect(editRatio("Hi Priya, hello", "Hi Priya hello")).toBeGreaterThan(0));
  it("is 1 when nothing of the original remains", () => expect(editRatio("one two three", "alpha beta gamma delta")).toBe(1));
  it("grows with the size of the change", () => {
    const small = editRatio(BODY, BODY.replace("useful", "worthwhile"));
    const large = editRatio(BODY, "Hi Priya, a completely different message about something else entirely, with no overlap, thanks. Alex");
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(0.15);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(0.6);
  });
  it("is symmetric, so undoing an edit measures the same as making it", () => {
    const after = BODY.replace("useful", "worthwhile").replace("SOC 2", "SOC 2 Type II");
    expect(editRatio(BODY, after)).toBeCloseTo(editRatio(after, BODY), 6);
  });
  it("stays between 0 and 1", () => {
    for (const [a, b] of [["", "x"], ["x", ""], ["a b", "c d e f g"], [BODY, `${BODY} ${BODY}`]]) {
      const r = editRatio(a!, b!);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe("editStats", () => {
  it("counts words added and removed, and calls a large change a rewrite", () => {
    const polish = editStats(BODY, BODY.replace("useful", "worthwhile"));
    expect(polish).toMatchObject({ added: 1, removed: 1, rewrite: false });
    const rewrite = editStats(BODY, "Hi Priya, a completely different message about something else entirely, with no overlap, thanks. Alex");
    expect(rewrite.rewrite).toBe(true);
    expect(rewrite.ratio).toBeGreaterThanOrEqual(REWRITE_AT);
  });
  it("reports no edit as no edit", () => expect(editStats(BODY, BODY)).toEqual({ ratio: 0, added: 0, removed: 0, rewrite: false }));
});
