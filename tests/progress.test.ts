import { describe, expect, it } from "vitest";
import { creepValue, DEFAULT_SECONDS, DOING, estimateRun, STEPS_PER_PASS, MIN_SAMPLES, roughTime, stepSeconds, WORK_STEPS } from "@/lib/app/progress";

const at = (step: string, lane = "active") => ({ step, lane });
const PER = WORK_STEPS.reduce((n, s) => n + DEFAULT_SECONDS[s], 0);

describe("estimateRun", () => {
  it("is 0% for a run that has not started and 100% when nothing is left", () => {
    expect(estimateRun([at("queued"), at("queued")]).percent).toBe(0);
    const done = estimateRun([at("sent", "sent"), at("drafted", "review")]);
    expect(done).toMatchObject({ percent: 100, finished: true, remainingSeconds: null, doing: null, stageIndex: null, active: 0 });
  });

  it("counts work done by step, not just finished companies", () => {
    const e = estimateRun([at("pains_chosen"), at("queued")]);
    const doneWork = PER - (DEFAULT_SECONDS.pains_chosen + DEFAULT_SECONDS.drafted);
    expect(e.percent).toBe(Math.floor((doneWork / (PER * 2)) * 100));
    expect(e.active).toBe(2);
  });

  it("sums the steps still to do as the time left, since the worker takes one step at a time", () => {
    const e = estimateRun([at("queued"), at("scraped")]);
    expect(e.remainingSeconds).toBe(PER + (PER - DEFAULT_SECONDS.queued));
  });

  it("treats a company that stopped (not a fit, no contact, waiting for a person) as done", () => {
    const e = estimateRun([at("scraped", "not_fit"), at("queued")]);
    expect(e.remainingSeconds).toBe(PER);
    expect(e.percent).toBe(50);
  });

  it("never says 100% while something is still running", () => {
    const e = estimateRun([...Array(200).fill(at("sent", "sent")), at("drafted")]);
    expect(e.percent).toBeLessThan(100);
    expect(e.finished).toBe(false);
  });

  it("says what most waiting companies are doing, earlier step on a tie, and where the stage dots should sit", () => {
    expect(estimateRun([at("queued"), at("queued"), at("scraped")]).doing).toBe(DOING.queued);
    expect(estimateRun([at("scraped"), at("pains_chosen")]).doing).toBe(DOING.scraped);
    expect(estimateRun([at("scraped"), at("pains_chosen")]).stageIndex).toBe(1);
  });

  it("is 100% and finished for an empty run rather than dividing by zero", () => {
    expect(estimateRun([])).toMatchObject({ percent: 100, finished: true, total: 0 });
  });

  it("uses the learned time when it is given", () => {
    const e = estimateRun([at("queued")], { ...DEFAULT_SECONDS, queued: 100 });
    expect(e.remainingSeconds).toBe(PER - DEFAULT_SECONDS.queued + 100);
  });
});

describe("stepSeconds", () => {
  const ev = (step: string, ms: number, status = "ok") => ({ step, status, latency_ms: ms });
  const many = (step: string, ms: number, n = MIN_SAMPLES) => Array.from({ length: n }, () => ev(step, ms));

  it("keeps the defaults until it has seen a step enough times", () => {
    expect(stepSeconds([ev("draft", 5000), ev("draft", 5000)])).toEqual(DEFAULT_SECONDS);
  });

  it("learns the typical time of a step from the middle of what it saw, not one freak value", () => {
    const s = stepSeconds([...many("draft", 8000), ev("draft", 90_000)]);
    expect(s.pains_chosen).toBe(8);
  });

  it("maps each event to the step a company waits at when that work is next", () => {
    const s = stepSeconds([...many("scrape", 12_000), ...many("qualify", 20_000), ...many("contact", 4000), ...many("pains", 9000), ...many("send", 3000)]);
    expect(s).toMatchObject({ queued: 12, scraped: 20, qualified: 4, contact_found: 9, drafted: 3 });
  });

  it("ignores failures, missing times and steps it does not know, and keeps a wild value inside a sane range", () => {
    const s = stepSeconds([...many("draft", 1000, 5).map((e) => ({ ...e, status: "failed" })), ev("draft", 0), { step: "draft", status: "ok", latency_ms: null }, ...many("nonsense", 1000), ...many("scrape", 600_000, 5)]);
    expect(s.pains_chosen).toBe(DEFAULT_SECONDS.pains_chosen);
    expect(s.queued).toBe(DEFAULT_SECONDS.queued * 4);
  });
});

describe("creep: the bar moves while a pass is under way", () => {
  it("aims at where the work will be after one worker pass (up to three steps), for the company being worked on", () => {
    const e = estimateRun([at("queued")]);
    const pass = WORK_STEPS.slice(0, STEPS_PER_PASS).reduce((n, s) => n + DEFAULT_SECONDS[s], 0);
    expect(e.creepSeconds).toBe(pass);
    expect(e.creepTo).toBe(Math.floor((pass / PER) * 100));
    expect(e.creepTo).toBeGreaterThan(e.percent + 20);
  });

  it("follows the company a worker holds, not the first in the list", () => {
    const e = estimateRun([{ step: "queued", lane: "active" }, { step: "pains_chosen", lane: "active", running: true }]);
    expect(e.creepSeconds).toBe(DEFAULT_SECONDS.pains_chosen + DEFAULT_SECONDS.drafted);
  });

  it("falls back to the furthest-behind company when no worker holds one", () => {
    const e = estimateRun([{ step: "contact_found", lane: "active" }, { step: "scraped", lane: "active" }]);
    expect(e.creepSeconds).toBe(WORK_STEPS.slice(1, 1 + STEPS_PER_PASS).reduce((n, s) => n + DEFAULT_SECONDS[s], 0));
  });

  it("has nothing to creep toward when the run is over, and never aims past 99", () => {
    expect(estimateRun([at("sent", "sent")])).toMatchObject({ creepTo: 100, creepSeconds: 0 });
    expect(estimateRun([at("queued")], { ...DEFAULT_SECONDS, queued: 1e6 }).creepTo).toBeLessThanOrEqual(99);
  });

  it("climbs with time, stops at 90% of the way, and never goes backwards or starts before the real figure", () => {
    expect(creepValue(10, 50, 20, 0)).toBe(10);
    expect(creepValue(10, 50, 20, 10)).toBe(30);
    expect(creepValue(10, 50, 20, 20)).toBe(46);
    expect(creepValue(10, 50, 20, 500)).toBe(46);
    expect(creepValue(10, 50, 20, -5)).toBe(10);
    expect(creepValue(60, 50, 20, 10)).toBe(60);
    expect(creepValue(10, 50, 0, 10)).toBe(10);
  });
});

describe("roughTime", () => {
  it("rounds the way a person says it, never falsely exact", () => {
    expect(roughTime(10)).toBe("under a minute");
    expect(roughTime(44)).toBe("under a minute");
    expect(roughTime(60)).toBe("about 1 minute");
    expect(roughTime(200)).toBe("about 3 minutes");
    expect(roughTime(3600)).toBe("about 1 hour");
    expect(roughTime(3600 + 20 * 60)).toBe("about 1 hour 20 minutes");
    expect(roughTime(2 * 3600)).toBe("about 2 hours");
  });
});
