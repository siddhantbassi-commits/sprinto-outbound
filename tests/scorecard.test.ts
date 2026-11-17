import { describe, expect, it } from "vitest";
import { AIM_REWRITE, computeScorecard, inRange, isRewrite, KILL_CONTACT, KILL_REWRITE, MIN_DECIDED, sampleScenario, type ReviewRow, type TimeFacts } from "@/lib/app/scorecard";
import { rangeFor } from "@/lib/app/impact";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const time = (o: Partial<TimeFacts> = {}): TimeFacts => ({ researched: 20, baselineMinutes: 400, humanMinutes: 30, machineMinutes: 12, savedMinutes: 370, manualMinutesPerCompany: 20, ...o });
const approve = (edit = 0, ok = true): ReviewRow => ({ action: "approve", edit_ratio: edit, contact_ok: ok, created_at: new Date(NOW).toISOString() });
const reject = (ok = true): ReviewRow => ({ action: "reject", edit_ratio: 0, contact_ok: ok, created_at: new Date(NOW).toISOString() });
const many = (n: number, f: () => ReviewRow) => Array.from({ length: n }, f);
const get = (s: ReturnType<typeof computeScorecard>, id: string) => s.criteria.find((c) => c.id === id)!;

describe("what counts as a rewrite", () => {
  it("is a rejection, or an approval that changed at least 15% of the words", () => {
    expect(isRewrite(reject())).toBe(true);
    expect(isRewrite(approve(0.15))).toBe(true);
    expect(isRewrite(approve(0.149))).toBe(false);
    expect(isRewrite(approve(0))).toBe(false);
    expect(isRewrite({ ...approve(), edit_ratio: "0.4" })).toBe(true);
  });
});

describe("a small sample is never good news", () => {
  it("says not enough data below the floor, whatever the numbers look like", () => {
    const s = computeScorecard({ reviews: many(MIN_DECIDED - 1, () => approve()), time: time() });
    expect(get(s, "rewrites").status).toBe("unknown");
    expect(get(s, "contacts").status).toBe("unknown");
    expect(s.verdict).toBe("insufficient");
    expect(s.headline).toContain("1 more decision needed");
  });

  it("also refuses to call a disaster a kill on too few decisions", () => {
    const s = computeScorecard({ reviews: many(3, () => reject(false)), time: time() });
    expect(get(s, "rewrites").status).toBe("unknown");
    expect(s.verdict).toBe("insufficient");
  });

  it("is judged once the floor is reached", () => {
    expect(get(computeScorecard({ reviews: many(MIN_DECIDED, () => approve()), time: time() }), "rewrites").status).toBe("ok");
  });

  it("needs enough companies for the time verdict too", () => {
    const s = computeScorecard({ reviews: many(10, () => approve()), time: time({ researched: 3, savedMinutes: -50 }) });
    expect(get(s, "time").status).toBe("unknown");
  });
});

describe("emails rewritten", () => {
  const rate = (rewritten: number, total = 20) => computeScorecard({ reviews: [...many(rewritten, () => reject()), ...many(total - rewritten, () => approve())], time: time() });

  it("is on aim below 20%, watched from 20% to 50%, and a kill above 50%", () => {
    expect(get(rate(3), "rewrites").status).toBe("ok");
    expect(get(rate(4), "rewrites").status).toBe("watch");
    expect(get(rate(10), "rewrites").status).toBe("watch");
    expect(get(rate(11), "rewrites").status).toBe("kill");
    expect(AIM_REWRITE).toBe(0.2);
    expect(KILL_REWRITE).toBe(0.5);
  });

  it("counts heavy edits as rewrites and polish as not", () => {
    const s = computeScorecard({ reviews: [...many(5, () => approve(0.4)), ...many(15, () => approve(0.05))], time: time() });
    expect(get(s, "rewrites").value).toBe(0.25);
    expect(get(s, "rewrites").working).toContain("5 of 20");
  });

  it("shows the working in words", () => {
    const w = get(rate(4), "rewrites").working;
    expect(w).toContain("4 of 20 drafts were rewritten: 4 rejected");
  });
});

describe("right person chosen", () => {
  const acc = (wrong: number, total = 20) => computeScorecard({ reviews: [...many(wrong, () => reject(false)), ...many(total - wrong, () => approve())], time: time() });

  it("is a kill below 60%, a warning within ten points above it, and fine otherwise", () => {
    expect(get(acc(9), "contacts").status).toBe("kill");
    expect(get(acc(8), "contacts").status).toBe("watch");
    expect(get(acc(7), "contacts").status).toBe("watch");
    expect(get(acc(6), "contacts").status).toBe("ok");
    expect(KILL_CONTACT).toBe(0.6);
  });

  it("does not blame the contact for a rejection that was about something else", () => {
    const s = computeScorecard({ reviews: [...many(6, () => reject(true)), ...many(14, () => approve())], time: time() });
    expect(get(s, "contacts").value).toBe(1);
  });
});

describe("time saved", () => {
  it("is a kill when the system costs more person time than it saves", () => {
    expect(get(computeScorecard({ reviews: many(10, () => approve()), time: time({ savedMinutes: -1 }) }), "time").status).toBe("kill");
    expect(get(computeScorecard({ reviews: many(10, () => approve()), time: time({ savedMinutes: 0 }) }), "time").status).toBe("ok");
  });

  it("is watched when it saves time but person time per company is over 2 minutes", () => {
    const s = computeScorecard({ reviews: many(10, () => approve()), time: time({ researched: 20, humanMinutes: 41, savedMinutes: 100 }) });
    expect(s.personMinutesPerCompany).toBeCloseTo(2.05);
    expect(get(s, "time").status).toBe("watch");
    expect(get(computeScorecard({ reviews: many(10, () => approve()), time: time({ humanMinutes: 40 }) }), "time").status).toBe("ok");
  });

  it("says it is an estimate", () => {
    expect(get(computeScorecard({ reviews: [], time: time() }), "time").working).toContain("An estimate");
  });
});

describe("the overall verdict", () => {
  it("stops when any criterion is a kill, and says which", () => {
    const s = computeScorecard({ reviews: many(20, () => reject(false)), time: time() });
    expect(s.verdict).toBe("stop");
    expect(s.headline).toContain("emails rewritten and right person chosen have crossed their kill line");
  });

  it("lists three kills with commas, not a chain of ands", () => {
    const s = computeScorecard({ reviews: many(20, () => reject(false)), time: time({ savedMinutes: -10 }) });
    expect(s.headline).toContain("emails rewritten, right person chosen and time saved have crossed their kill line");
  });

  it("a kill outranks missing data elsewhere", () => {
    const s = computeScorecard({ reviews: many(10, () => approve()), time: time({ researched: 3, savedMinutes: -50 }) });
    expect(s.verdict).toBe("insufficient");
    const t = computeScorecard({ reviews: many(20, () => reject()), time: time({ researched: 3 }) });
    expect(t.verdict).toBe("stop");
  });

  it("only says keep going when everything is inside its limit and on aim", () => {
    expect(computeScorecard({ reviews: many(20, () => approve()), time: time() }).verdict).toBe("continue");
    expect(computeScorecard({ reviews: [...many(5, () => reject()), ...many(15, () => approve())], time: time() }).verdict).toBe("watch");
  });

  it("copes with no decisions at all", () => {
    const s = computeScorecard({ reviews: [], time: time({ researched: 0, baselineMinutes: 0, humanMinutes: 0, machineMinutes: 0, savedMinutes: 0 }) });
    expect(s.verdict).toBe("insufficient");
    expect(s.personMinutesPerCompany).toBeNull();
    expect(get(s, "rewrites").display).toBe("-");
    expect(s.headline).toContain(`${MIN_DECIDED} more decisions needed`);
  });
});

describe("the period", () => {
  it("keeps only decisions inside the range", () => {
    const old: ReviewRow = { ...approve(), created_at: new Date(NOW - 40 * 86_400_000).toISOString() };
    const r = rangeFor("30", NOW);
    expect(inRange([approve(), old], r)).toHaveLength(1);
    expect(inRange([approve(), old], rangeFor("all", NOW))).toHaveLength(2);
    const later: ReviewRow = { ...approve(), created_at: new Date(NOW + 3_600_000).toISOString() };
    expect(inRange([approve(), later], r)).toHaveLength(1);
  });
});

describe("the demo's sample scenarios", () => {
  it.each([["healthy", "continue"], ["watch", "watch"], ["kill", "stop"]] as const)("%s reads as %s", (kind, verdict) => {
    const { reviews, time: t } = sampleScenario(kind, NOW);
    expect(computeScorecard({ reviews, time: t }).verdict).toBe(verdict);
  });
});
