import { describe, expect, it } from "vitest";
import { computeImpact, hours, normaliseReason, rangeFor, renderReport, type ImpactInput } from "@/lib/app/impact";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const A = { manualMinutes: 20, reviewMinutesPerEmail: 1.5, reviewMinutesPerDecision: 2 };

interface P { id: string; lane?: string; reason?: string | null; verdict?: string | null; age?: number; ok?: string[]; parked?: string[]; latency?: number }

/** Builds a consistent world from short descriptions of each prospect. */
function world(ps: P[], extra: Partial<ImpactInput> = {}): ImpactInput {
  const events: ImpactInput["events"] = [];
  for (const p of ps) {
    for (const s of p.ok ?? []) events.push({ prospect_id: p.id, step: s, status: "ok", latency_ms: p.latency ?? 1000 });
    for (const s of p.parked ?? []) events.push({ prospect_id: p.id, step: s, status: "parked", latency_ms: p.latency ?? 1000 });
  }
  return {
    range: rangeFor("30", NOW),
    assumptions: A,
    prospects: ps.map((p) => ({ id: p.id, lane: p.lane ?? "active", lane_reason: p.reason ?? null, verdict: p.verdict ?? null, created_at: day(p.age ?? 1) })),
    events,
    draftEvents: [],
    facts: [],
    pages: [],
    usage: [],
    decisions: [],
    ...extra,
  };
}
const SENT = (id: string, age = 1): P => ({ id, lane: "sent", verdict: "qualified", age, ok: ["scrape", "qualify", "contact", "pains", "draft"] });

describe("rangeFor", () => {
  it("defaults to 30 days, and knows 7 days and all time", () => {
    expect(rangeFor(undefined, NOW)).toMatchObject({ key: "30", label: "Last 30 days", from: NOW - 30 * 86_400_000 });
    expect(rangeFor("7", NOW)).toMatchObject({ key: "7", from: NOW - 7 * 86_400_000 });
    expect(rangeFor("all", NOW)).toMatchObject({ key: "all", from: null, label: "All time" });
    expect(rangeFor("banana", NOW).key).toBe("30");
  });
});

describe("computeImpact: the funnel", () => {
  const ps: P[] = [
    SENT("a"),
    SENT("b"),
    { id: "c", lane: "no_contact", verdict: "qualified", reason: "1 candidate(s), none suitable", ok: ["scrape", "qualify"], parked: ["contact"] },
    { id: "d", lane: "not_fit", verdict: "not_fit", reason: "Scored 38, below 45.", ok: ["scrape"], parked: ["qualify"] },
    { id: "e", lane: "not_fit", verdict: "not_fit", reason: "Scored 41, below 45.", ok: ["scrape"], parked: ["qualify"] },
    { id: "f", lane: "needs_more", verdict: "needs_more", reason: "Not enough to judge", ok: ["scrape"], parked: ["qualify"] },
    { id: "g", lane: "skipped", reason: "Suppressed: do not contact" },
    { id: "h", lane: "needs_more", reason: "The site could not be read: HTTP 404", parked: ["scrape"] },
    { id: "i", lane: "active" },
  ];
  const x = computeImpact(world(ps));

  it("counts each stage by what the trace shows happened", () => {
    expect(x.funnel.map((s) => [s.key, s.count])).toEqual([["added", 9], ["read", 6], ["qualified", 3], ["contact", 2], ["drafted", 2], ["sent", 2]]);
    expect([x.domains, x.researched, x.qualified, x.contactFound, x.drafted, x.sent]).toEqual([9, 6, 3, 2, 2, 2]);
  });

  it("says where the rest went, with reasons grouped once digits are folded", () => {
    const by = Object.fromEntries(x.dropoffs.map((d) => [d.lane, d]));
    expect(x.dropoffs.map((d) => d.lane)).toEqual(["needs_more", "not_fit", "no_contact", "skipped"]);
    expect(by.not_fit).toMatchObject({ count: 2, reasons: [{ text: "Scored #, below #.", count: 2 }] });
    expect(by.needs_more!.count).toBe(2);
    expect(by.skipped!.reasons[0]!.text).toBe("Suppressed: do not contact");
    expect(x.dropoffs.some((d) => d.lane === "sent" || d.lane === "active")).toBe(false);
  });

  it("computes the rates with their numerators and denominators", () => {
    expect(x.rates.qualification).toEqual({ value: 3 / 6, numerator: 3, denominator: 6 });
    expect(x.rates.contactHit).toEqual({ value: 2 / 3, numerator: 2, denominator: 3 });
    expect(x.rates.sendThrough).toEqual({ value: 2 / 3, numerator: 2, denominator: 3 });
  });

  it("counts a site that could not be read as a scrape failure, and not a skipped domain", () => {
    // 9 added, 1 skipped (never attempted) -> 8 attempted, 6 read -> 2 failed (h, and i which has not been read yet)
    expect(x.rates.scrapeFailure).toEqual({ value: 2 / 8, numerator: 2, denominator: 8 });
  });
});

describe("computeImpact: the time saved, with its working", () => {
  it("is the manual baseline minus the person time still spent, line by line", () => {
    const ps = [SENT("a"), SENT("b"), SENT("c"), { id: "d", lane: "not_fit", verdict: "not_fit", ok: ["scrape"] }] as P[];
    const decisions = [{ prospect_id: "a", kind: "promote", created_at: day(1) }, { prospect_id: "d", kind: "skip", created_at: day(1) }];
    const x = computeImpact(world(ps, { decisions }));
    // 4 researched x 20 = 80; reading 3 emails x 1.5 = 4.5; 2 decisions x 2 = 4; saved = 80 - 8.5 = 71.5
    expect(x.time.lines.map((l) => l.minutes)).toEqual([80, -4.5, -4]);
    expect(x.time).toMatchObject({ baselineMinutes: 80, humanMinutes: 8.5, savedMinutes: 71.5, decisions: 2 });
    expect(x.time.lines[0]!.note).toBe("4 companies researched × 20 min each, the baseline set in Settings");
  });

  it("goes negative, and says so, when people spent more time than the manual way would have", () => {
    const x = computeImpact(world([SENT("a")], { assumptions: { manualMinutes: 2, reviewMinutesPerEmail: 5, reviewMinutesPerDecision: 5 } }));
    expect(x.time.savedMinutes).toBe(-3);
  });

  it("sums the machine time separately, as information, never as a saving", () => {
    const x = computeImpact(world([{ ...SENT("a"), latency: 30_000 }]));
    // five ok events of 30 s each
    expect(x.time.machineMinutes).toBe(2.5);
    expect(x.time.savedMinutes).toBe(20 - 1.5);
  });

  it("counts only decisions about prospects in this period, and ignores run-level ones", () => {
    const decisions = [
      { prospect_id: "a", kind: "promote", created_at: day(1) },
      { prospect_id: "a", kind: "promote", created_at: day(60) },
      { prospect_id: null, kind: "pause_run", created_at: day(1) },
      { prospect_id: "ghost", kind: "skip", created_at: day(1) },
    ];
    expect(computeImpact(world([SENT("a")], { decisions })).time.decisions).toBe(1);
  });

  it("always states that these are assumptions, and warns when there is too little data", () => {
    const few = computeImpact(world([SENT("a")]));
    expect(few.notes[0]).toMatch(/assumptions an admin sets/);
    expect(few.notes.join(" ")).toMatch(/Only 1 company has been researched/);
    const many = computeImpact(world(Array.from({ length: 6 }, (_, i) => SENT(`p${i}`))));
    expect(many.notes.join(" ")).not.toMatch(/Only \d/);
  });
});

describe("computeImpact: the period", () => {
  it("counts only prospects created inside the range, and everything that belongs to them", () => {
    const ps = [SENT("new", 2), SENT("old", 45)];
    const usage = [{ prospect_id: "new", kind: "gemini_tokens", units: 1000 }, { prospect_id: "old", kind: "gemini_tokens", units: 9000 }];
    expect(computeImpact(world(ps, { usage })).usage.tokens).toBe(1000);
    expect(computeImpact(world(ps, { usage, range: rangeFor("all", NOW) })).usage.tokens).toBe(10_000);
    expect(computeImpact(world(ps, { range: rangeFor("7", NOW) })).domains).toBe(1);
  });

  it("excludes a prospect created in the future or with an unreadable date", () => {
    const x = computeImpact({ ...world([SENT("a")]), prospects: [{ id: "a", lane: "sent", lane_reason: null, verdict: null, created_at: "not a date" }, { id: "b", lane: "sent", lane_reason: null, verdict: null, created_at: new Date(NOW + 86_400_000).toISOString() }] });
    expect(x.domains).toBe(0);
  });
});

describe("computeImpact: quality and cost", () => {
  it("measures first-pass lint from the first draft attempt, not the final one", () => {
    const ps = [SENT("a"), SENT("b"), SENT("c")];
    const draftEvents = [
      { prospect_id: "a", status: "ok", output: { attempts: [{ n: 1, failed: [] }] } },
      { prospect_id: "b", status: "ok", output: { attempts: [{ n: 1, failed: ["L5"] }, { n: 2, failed: [] }] } },
      { prospect_id: "c", status: "parked", output: { attempts: [{ n: 1, failed: ["L1"] }, { n: 2, failed: ["L1"] }, { n: 3, failed: ["L1"] }] } },
      { prospect_id: "zzz", status: "ok", output: { attempts: [{ n: 1, failed: [] }] } },
      { prospect_id: "a", status: "parked", output: { attempts: [] } },
    ];
    expect(computeImpact(world(ps, { draftEvents })).rates.firstPassLint).toEqual({ value: 1 / 3, numerator: 1, denominator: 3 });
  });

  it("uses each prospect's last extraction pass for the quote check, not every pass", () => {
    const facts = [
      { prospect_id: "a", pass: 1, grounding: { checked: 10, failures: ["x", "y", "z"] } },
      { prospect_id: "a", pass: 2, grounding: { checked: 12, failures: ["x"] } },
      { prospect_id: "b", pass: 1, grounding: { checked: 8, failures: [] } },
    ];
    expect(computeImpact(world([SENT("a"), SENT("b")], { facts })).rates.groundingFailure).toEqual({ value: 1 / 20, numerator: 1, denominator: 20 });
  });

  it("measures thin pages, tokens and credits per company and per person found", () => {
    const x = computeImpact(
      world([SENT("a"), SENT("b")], {
        pages: [{ prospect_id: "a", thin: false }, { prospect_id: "a", thin: true }, { prospect_id: "b", thin: false }, { prospect_id: "b", thin: false }],
        usage: [
          { prospect_id: "a", kind: "gemini_tokens", units: "3600" },
          { prospect_id: "b", kind: "gemini_tokens", units: 3600 },
          { prospect_id: "a", kind: "hunter_credits", units: 1 },
          { prospect_id: "b", kind: "hunter_credits", units: 0 },
          { prospect_id: "a", kind: "gmail_send", units: 1 },
          { prospect_id: "b", kind: "gmail_send", units: 1 },
        ],
      }),
    );
    expect(x.rates.thinPage).toEqual({ value: 1 / 4, numerator: 1, denominator: 4 });
    expect(x.usage).toEqual({ tokens: 7200, tokensPerCompany: 3600, hunterCredits: 1, creditsPerContact: 0.5, sends: 2 });
  });

  it("gives null, not zero, when there is nothing to divide by", () => {
    const x = computeImpact(world([]));
    expect(x.rates.qualification).toEqual({ value: null, numerator: 0, denominator: 0 });
    expect(x.rates.contactHit.value).toBeNull();
    expect(x.usage).toMatchObject({ tokensPerCompany: null, creditsPerContact: null });
    expect(x.time.savedMinutes).toBe(0);
    expect(x.dropoffs).toEqual([]);
  });

  it("counts replies and bounces only if someone recorded them", () => {
    expect(computeImpact(world([SENT("a")])).replies).toEqual({ replies: 0, bounces: 0, recorded: false });
    const decisions = [{ prospect_id: "a", kind: "mark_reply", created_at: day(1) }, { prospect_id: "a", kind: "mark_bounce", created_at: day(1) }];
    expect(computeImpact(world([SENT("a")], { decisions })).replies).toEqual({ replies: 1, bounces: 1, recorded: true });
    expect(computeImpact(world([SENT("a")])).notes.join(" ")).toMatch(/No outcomes have been recorded yet/);
  });
});

describe("normaliseReason, hours and renderReport", () => {
  it("folds digits and whitespace, and names a missing reason", () => {
    expect(normaliseReason("Scored 38.5, below  45.")).toBe("Scored #, below #.");
    expect(normaliseReason(null)).toBe("No reason recorded");
    expect(normaliseReason("x".repeat(200))).toHaveLength(90);
  });

  it("writes minutes under an hour and a half and hours above", () => {
    expect(hours(30)).toBe("30 minutes");
    expect(hours(89)).toBe("89 minutes");
    expect(hours(90)).toBe("1.5 hours");
    expect(hours(-120)).toBe("-2 hours");
    expect(hours(0.4)).toBe("under a minute");
    expect(hours(0)).toBe("0 minutes");
  });

  it("renders the weekly report with the working, the quality figures, where the rest went and the caveats", () => {
    const ps: P[] = [SENT("a"), SENT("b"), { id: "d", lane: "not_fit", verdict: "not_fit", reason: "Scored 38, below 45.", ok: ["scrape"], parked: ["qualify"] }];
    const text = renderReport(computeImpact(world(ps)), { from: "28 Oct", to: "4 Nov" });
    expect(text).toContain("Sprinto Outbound: last 30 days (28 Oct to 4 Nov)");
    expect(text).toContain("Researched (site read): 3");
    expect(text).toContain("Qualified: 2, which is 67% (2 of 3) of those researched");
    expect(text).toMatch(/\+ 60 minutes: By hand, the manual way, 3 companies researched × 20 min each/);
    expect(text).toMatch(/- 3 minutes: Reading each email before it goes, 2 emails × 1\.5 min/);
    expect(text).toContain("= 57 minutes saved");
    expect(text).toContain("not_fit".replace("_", " ") + ": 1, mostly “Scored #, below #.”");
    expect(text).toMatch(/Notes\n {2}- The manual baseline/);
  });

  it("says 'not enough data' instead of inventing a percentage", () => {
    expect(renderReport(computeImpact(world([])), { from: "a", to: "b" })).toContain("not enough data");
  });
});
