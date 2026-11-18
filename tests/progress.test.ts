import { describe, expect, it } from "vitest";
import { DEFAULT_SECONDS, DOING, estimateRun, MIN_SAMPLES, roughTime, stepSeconds, WORK_STEPS } from "@/lib/app/progress";

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
