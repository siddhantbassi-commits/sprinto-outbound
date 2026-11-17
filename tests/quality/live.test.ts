import { describe, expect, it } from "vitest";
import { computeLive, HEARTBEAT, judge, MIN_COMPANIES, RULES, type LiveInput, type TraceEvent } from "@/lib/quality/live";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

interface C { id: string; age: number; lane?: string; scraped?: boolean; model?: string; prompt?: string; status?: string; latency?: number; tokens?: number; thin?: boolean; pageCount?: number; checked?: number; failures?: number }

function world(cs: C[], over: Partial<LiveInput> = {}): LiveInput {
  const events: TraceEvent[] = [];
  const impactEvents: LiveInput["impact"]["events"] = [];
  const prospects: LiveInput["impact"]["prospects"] = [];
  const facts: LiveInput["impact"]["facts"] = [];
  const pages: LiveInput["impact"]["pages"] = [];
  for (const c of cs) {
    prospects.push({ id: c.id, lane: c.lane ?? "active", lane_reason: null, verdict: null, created_at: at(c.age) });
    const scraped = c.scraped ?? true;
    if (scraped) {
      impactEvents.push({ prospect_id: c.id, step: "scrape", status: "ok", latency_ms: 100 });
      events.push({ prospect_id: c.id, step: "scrape", status: c.status ?? "ok", latency_ms: c.latency ?? 100, model: c.model ?? "m1", prompt_version: c.prompt ?? "p1", tokens: c.tokens ?? 1000, created_at: at(c.age) });
      for (let k = 0; k < (c.pageCount ?? 1); k++) pages.push({ prospect_id: c.id, thin: !!c.thin });
      facts.push({ prospect_id: c.id, pass: 1, grounding: { checked: c.checked ?? 4, failures: Array.from({ length: c.failures ?? 0 }, (_, i) => `f${i}`) } });
    }
  }
  return { now: NOW, days: 7, impact: { prospects, events: impactEvents, draftEvents: [], facts, pages, usage: [], decisions: [] }, events, lastTick: at(0.001), activeNow: 0, unknownNow: 0, ...over };
}
let seq = 0;
const many = (n: number, age: number, f: (i: number) => Partial<C> = () => ({})): C[] => Array.from({ length: n }, (_, i) => ({ id: `c${seq++}`, age, ...f(i) }));
const get = (l: ReturnType<typeof computeLive>, key: string) => l.readings.find((r) => r.key === key)!;

describe("judge", () => {
  it("never judges a sample below the minimum, however extreme the value", () => {
    for (const v of [0, 0.5, 1]) expect(judge(RULES.groundingFailure, v, RULES.groundingFailure.minN - 1, null, 0).status).toBe("not_enough");
    expect(judge(RULES.groundingFailure, null, 500, null, 0).status).toBe("not_enough");
  });
  it("says how many it has and how many it needs", () => {
    expect(judge(RULES.scrapeFailure, 1, 3, null, 0).why).toMatch(/Only 3 sites tried; at least 10/);
  });
  it("lower-is-better: the watch and bad lines belong to the worse side", () => {
    const r = RULES.groundingFailure;
    expect(judge(r, 0.049, 100, null, 0).status).toBe("good");
    expect(judge(r, 0.05, 100, null, 0).status).toBe("watch");
    expect(judge(r, 0.149, 100, null, 0).status).toBe("watch");
    expect(judge(r, 0.15, 100, null, 0).status).toBe("bad");
  });
  it("higher-is-better: below the line is the bad side, and the line itself is fine", () => {
    const r = RULES.contactHit;
    expect(judge(r, 0.5, 100, null, 0).status).toBe("good");
    expect(judge(r, 0.49, 100, null, 0).status).toBe("watch");
    expect(judge(r, 0.25, 100, null, 0).status).toBe("watch");
    expect(judge(r, 0.24, 100, null, 0).status).toBe("bad");
  });
  it("a swing is judged both ways, and only against a week with enough data", () => {
    const r = RULES.qualification;
    expect(judge(r, 0.5, 50, 0.45, 50).status).toBe("good");
    expect(judge(r, 0.7, 50, 0.5, 50).status).toBe("watch");
    expect(judge(r, 0.2, 50, 0.6, 50).status).toBe("bad");
    expect(judge(r, 0.55, 50, 0.2, 50).status).toBe("bad"); // exactly 35 points
    expect(judge(r, 0.7, 50, 0.1, 3)).toMatchObject({ status: "info", delta: null });
  });
  it("reports the change only when both weeks were big enough", () => {
    expect(judge(RULES.thinPage, 0.2, 40, 0.1, 40).delta).toBeCloseTo(0.1);
    expect(judge(RULES.thinPage, 0.2, 40, 0.1, 5).delta).toBeNull();
    expect(judge(RULES.thinPage, 0.2, 40, null, 0).delta).toBeNull();
  });
});

describe("computeLive", () => {
  it("with no data at all, nothing is judged and nothing looks fine", () => {
    const l = computeLive(world([], { lastTick: null }));
    expect(l.overall).toBe("not_enough");
    expect(l.judged).toBeLessThan(l.total);
    for (const r of l.readings.filter((x) => x.unit === "percent")) expect(r.status, r.key).toBe("not_enough");
  });

  it("a perfect but tiny sample is not enough, not good", () => {
    const l = computeLive(world(many(4, 1)));
    expect(get(l, "scrapeFailure")).toMatchObject({ status: "not_enough", n: 4 });
    expect(get(l, "groundingFailure").status).toBe("not_enough");
    expect(l.overall).toBe("not_enough");
  });

  it("with enough clean work, readings are good and so is the whole", () => {
    const l = computeLive(world(many(40, 1)));
    expect(get(l, "scrapeFailure").status).toBe("good");
    expect(get(l, "groundingFailure").status).toBe("good");
    expect(get(l, "thinPage").status).toBe("good");
  });

  it("does not judge a per-quote rate from a few companies, however many quotes they gave", () => {
    const few = computeLive(world(many(MIN_COMPANIES - 1, 1, () => ({ checked: 30, failures: 0 }))));
    expect(get(few, "groundingFailure")).toMatchObject({ status: "not_enough" });
    expect(get(few, "groundingFailure").n).toBeGreaterThan(RULES.groundingFailure.minN);
    expect(get(few, "groundingFailure").why).toMatch(/only \d+ companies/i);
    const pages = computeLive(world(many(MIN_COMPANIES - 1, 1, () => ({ pageCount: 5 }))));
    expect(get(pages, "thinPage")).toMatchObject({ status: "not_enough", n: 35 });
    const enough = computeLive(world(many(MIN_COMPANIES, 1, () => ({ checked: 30, failures: 0 }))));
    expect(get(enough, "groundingFailure").status).toBe("good");
  });

  it("does not judge retries from a few companies either", () => {
    const l = computeLive(world(many(MIN_COMPANIES - 1, 1, () => ({ status: "ok" }))));
    expect(get(l, "retryRate").status).toBe("not_enough");
    const a = world(many(2, 1)); // two companies with many steps each
    a.events = Array.from({ length: 40 }, (_, i) => ({ ...a.events[i % 2]!, status: "ok" }));
    expect(get(computeLive(a), "retryRate")).toMatchObject({ status: "not_enough", n: 40 });
  });

  it("flags a rise in quotes that were not on the page", () => {
    const l = computeLive(world(many(10, 1, () => ({ checked: 5, failures: 2 })))); // 20 of 50 = 40%
    expect(get(l, "groundingFailure")).toMatchObject({ status: "bad", n: 50 });
    expect(l.overall).toBe("bad");
  });

  it("counts sites that could not be read, but not ones deliberately skipped", () => {
    const failed = many(10, 1, () => ({ scraped: false, lane: "failed" }));
    const skipped = many(5, 1, () => ({ scraped: false, lane: "skipped" }));
    const ok = many(10, 1);
    const l = computeLive(world([...failed, ...skipped, ...ok]));
    expect(get(l, "scrapeFailure")).toMatchObject({ n: 20, status: "bad" });
    expect(get(l, "scrapeFailure").value).toBeCloseTo(0.5);
  });

  it("separates this week from last week, and ignores anything older", () => {
    const l = computeLive(world([...many(20, 1), ...many(20, 10, () => ({ thin: true })), ...many(20, 30, () => ({ thin: true }))]));
    const t = get(l, "thinPage");
    expect(t.value).toBe(0);
    expect(t.previous).toBe(1);
    expect(t.delta).toBeCloseTo(-1);
  });

  it("measures retries and errors among steps run, not the quiet info rows", () => {
    const l = computeLive(world(many(40, 1, (i) => ({ status: i < 12 ? "retry" : "ok" }))));
    expect(get(l, "retryRate")).toMatchObject({ n: 40, status: "bad" });
    const info = computeLive(world(many(40, 1, () => ({ status: "info" }))));
    expect(get(info, "retryRate").status).toBe("not_enough");
    const errors = computeLive(world(many(40, 1, (i) => ({ status: i < 12 ? "error" : "ok" }))));
    expect(get(errors, "retryRate")).toMatchObject({ n: 40, status: "bad" });
  });

  it("gives the typical and the slow tail per company", () => {
    const l = computeLive(world(many(20, 1, (i) => ({ latency: (i + 1) * 100 }))));
    expect(get(l, "latencyP50").value).toBe(1000);
    expect(get(l, "latencyP95").value).toBe(1900);
    expect(get(l, "latencyP50").status).toBe("info");
  });

  it("notices a model or prompt that was not used last week", () => {
    const l = computeLive(world([...many(5, 1, () => ({ model: "m2", prompt: "p1" })), ...many(5, 10, () => ({ model: "m1", prompt: "p1" }))]));
    expect(get(l, "versions").status).toBe("watch");
    expect(l.changed).toEqual({ models: ["m2"], promptVersions: [] });
    expect(get(l, "versions").why).toMatch(/golden set/i);
    const p = computeLive(world([...many(5, 1, () => ({ prompt: "p2" })), ...many(5, 10, () => ({ prompt: "p1" }))]));
    expect(p.changed.promptVersions).toEqual(["p2"]);
  });

  it("calls the versions steady when they match, and cannot tell when last week was empty", () => {
    expect(get(computeLive(world([...many(5, 1), ...many(5, 10)])), "versions").status).toBe("good");
    const first = computeLive(world(many(5, 1)));
    expect(get(first, "versions").status).toBe("not_enough");
    expect(first.changed).toEqual({ models: [], promptVersions: [] });
  });

  it("raises an unknown send as bad at once, with no sample needed", () => {
    expect(get(computeLive(world([], { unknownNow: 1 })), "unknownSends").status).toBe("bad");
    expect(get(computeLive(world([], { unknownNow: 0 })), "unknownSends").status).toBe("good");
  });

  it("watches the worker only while work is waiting", () => {
    const hb = (ageMin: number | null, active: number) => get(computeLive(world([], { lastTick: ageMin === null ? null : new Date(NOW - ageMin * 60_000).toISOString(), activeNow: active })), "heartbeat").status;
    expect(hb(5, 3)).toBe("good");
    expect(hb(HEARTBEAT.watchMinutes + 1, 3)).toBe("watch");
    expect(hb(HEARTBEAT.badMinutes + 1, 3)).toBe("bad");
    expect(hb(HEARTBEAT.badMinutes + 1, 0)).toBe("good");
    expect(hb(null, 2)).toBe("bad");
    expect(hb(null, 0)).toBe("not_enough");
  });

  it("is not called healthy when most readings could not be judged", () => {
    // Only the state-based readings can be judged here.
    const l = computeLive(world([], { lastTick: at(0), activeNow: 0 }));
    expect(l.overall).toBe("not_enough");
    expect(l.judged).toBeGreaterThan(0);
  });

  it("the worst judged reading decides, even when the rest are fine", () => {
    const l = computeLive(world(many(40, 1), { unknownNow: 2 }));
    expect(l.overall).toBe("bad");
  });

  it("puts a company created exactly a week ago in this week only, never both", () => {
    const l = computeLive(world([{ id: "edge", age: 7, thin: true }, ...many(20, 1)]));
    const t = get(l, "thinPage");
    expect(t.n).toBe(21);
    expect(t.value).toBeCloseTo(1 / 21);
    expect(t.previous).toBeNull();
  });
});
