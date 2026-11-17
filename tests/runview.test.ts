import { describe, expect, it } from "vitest";
import { activity, duration, filterProspects, MIN_FOR_ETA, parseShow, runHeadline, runProgress, stageCounts, track, type RunProspect } from "@/lib/app/runview";

const p = (domain: string, step: string, lane: string): RunProspect => ({ id: domain, domain, step, lane });
const T0 = Date.parse("2026-11-17T10:00:00Z");

const mixed = [
  p("a.com", "sent", "sent"),
  p("b.com", "sent", "sent"),
  p("c.com", "drafted", "review"),
  p("d.com", "qualified", "skipped"),
  p("e.com", "scraped", "active"),
  p("f.com", "queued", "active"),
  p("g.com", "contact_found", "no_contact"),
];

describe("runProgress", () => {
  it("counts settled, active, sent and those waiting on a person", () => {
    const r = runProgress(mixed, new Date(T0), T0 + 600_000);
    expect(r).toMatchObject({ total: 7, settled: 5, active: 2, sent: 2, needsPerson: 2, percent: 71 });
  });

  it("gives no time estimate until enough companies have really been worked", () => {
    expect(MIN_FOR_ETA).toBe(3);
    const few = [p("a", "sent", "sent"), p("b", "sent", "sent"), p("c", "queued", "active")];
    expect(runProgress(few, new Date(T0), T0 + 600_000).etaMs).toBeNull();
  });

  it("estimates from the pace so far, leaving out companies skipped without any work", () => {
    const r = runProgress([p("a", "sent", "sent"), p("b", "sent", "sent"), p("c", "sent", "sent"), p("s1", "queued", "skipped"), p("s2", "queued", "skipped"), p("x", "queued", "active"), p("y", "queued", "active")], new Date(T0), T0 + 300_000);
    // 3 worked in 5 minutes, 2 to go: about 3 minutes and 20 seconds
    expect(r.etaMs).toBe(200_000);
  });

  it("stops the clock at the last step once nothing is active, and keeps counting while something is", () => {
    const done = [p("a", "sent", "sent"), p("b", "sent", "sent")];
    expect(runProgress(done, new Date(T0), T0 + 3_600_000, new Date(T0 + 90_000)).elapsedMs).toBe(90_000);
    const going = [p("a", "sent", "sent"), p("b", "queued", "active")];
    expect(runProgress(going, new Date(T0), T0 + 120_000, new Date(T0 + 90_000)).elapsedMs).toBe(120_000);
    expect(runProgress(done, new Date(T0), T0 + 60_000, new Date(T0 + 90_000)).elapsedMs).toBe(60_000);
    expect(runProgress(done, new Date(T0), T0 + 60_000).elapsedMs).toBe(60_000);
  });

  it("has no estimate when nothing is left, and copes with an empty run", () => {
    expect(runProgress([p("a", "sent", "sent"), p("b", "sent", "sent"), p("c", "sent", "sent")], new Date(T0), T0 + 60_000).etaMs).toBeNull();
    expect(runProgress([], new Date(T0), T0)).toMatchObject({ total: 0, percent: 0, etaMs: null });
  });
});

describe("stageCounts", () => {
  const s = stageCounts(mixed);
  const at = (step: string) => s.find((x) => x.step === step)!;

  it("counts everyone who has got at least as far as each step", () => {
    expect(at("queued").reached).toBe(7);
    expect(at("scraped").reached).toBe(6);
    expect(at("qualified").reached).toBe(5);
    expect(at("drafted").reached).toBe(3);
    expect(at("sent").reached).toBe(2);
  });

  it("separates those still working at a step from those that stopped there", () => {
    expect(at("scraped").working).toBe(1);
    expect(at("queued").working).toBe(1);
    expect(at("qualified").working).toBe(0);
    expect(at("drafted").working).toBe(0);
    expect(at("qualified").stopped).toBe(1);
    expect(at("drafted").stopped).toBe(1);
    expect(at("sent").stopped).toBe(0);
  });
});

describe("filtering", () => {
  it("shows each slice, and falls back to everything for an unknown value", () => {
    expect(filterProspects(mixed, "active").map((x) => x.domain)).toEqual(["e.com", "f.com"]);
    expect(filterProspects(mixed, "needs").map((x) => x.domain)).toEqual(["c.com", "g.com"]);
    expect(filterProspects(mixed, "sent").map((x) => x.domain)).toEqual(["a.com", "b.com"]);
    expect(filterProspects(mixed, "stopped").map((x) => x.domain)).toEqual(["d.com"]);
    expect(filterProspects(mixed, "all")).toHaveLength(7);
    expect(parseShow("nonsense")).toBe("all");
    expect(parseShow("needs")).toBe("needs");
  });
});

describe("track", () => {
  it("fills the dots to where the company is, marks the live one, and a stop", () => {
    expect(track(p("x", "qualified", "active"))).toEqual(["done", "done", "now", "todo", "todo", "todo", "todo"]);
    expect(track(p("x", "drafted", "review"))).toEqual(["done", "done", "done", "done", "done", "stop", "todo"]);
    expect(track(p("x", "sent", "sent"))).toEqual(Array(7).fill("done"));
  });
});

describe("activity", () => {
  const names = new Map([["a", "acme.com"]]);
  it("puts steps and people's decisions together, newest first, in words", () => {
    const a = activity(
      [{ id: 1, prospect_id: "a", step: "scrape", status: "ok", created_at: "2026-11-17T10:00:01Z" }, { id: 2, prospect_id: "a", step: "draft", status: "parked", created_at: "2026-11-17T10:00:05Z" }],
      [{ prospect_id: "a", kind: "promote", reason: "looks right", created_at: "2026-11-17T10:00:09Z" }],
      names,
    );
    expect(a.map((x) => x.text)).toEqual(['A person: promote, "looks right"', "Wrote the email (waiting for a person)", "Read the website"]);
    expect(a[2]).toMatchObject({ tone: "good", domain: "acme.com" });
    expect(a[1]!.tone).toBe("warn");
  });

  it("marks a failure, and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i, prospect_id: "a", step: "send", status: i === 29 ? "error" : "ok", created_at: new Date(T0 + i * 1000).toISOString() }));
    const a = activity(many, [], names, 5);
    expect(a).toHaveLength(5);
    expect(a[0]).toMatchObject({ text: "Sent the test email (failed)", tone: "bad" });
  });
});

describe("words", () => {
  it("says durations plainly", () => {
    expect(duration(3_000)).toBe("a few seconds");
    expect(duration(40_000)).toBe("40 seconds");
    expect(duration(60_000)).toBe("1 minute");
    expect(duration(200_000)).toBe("3 minutes");
    expect(duration(5_400_000)).toBe("1.5 hours");
  });

  it("headlines each state of a run", () => {
    const prog = (o: Partial<ReturnType<typeof runProgress>>) => ({ ...runProgress(mixed, new Date(T0), T0), ...o });
    expect(runHeadline(prog({}), false)).toBe("Working: 5 of 7 finished.");
    expect(runHeadline(prog({}), true)).toContain("Paused with 2 still to do");
    expect(runHeadline(prog({ active: 0 }), false)).toBe("Finished by the system. 2 companies need a person.");
    expect(runHeadline(prog({ active: 0, needsPerson: 1 }), false)).toBe("Finished by the system. 1 company needs a person.");
    expect(runHeadline(prog({ active: 0, needsPerson: 0, sent: 7 }), false)).toBe("Done: every company was sent.");
    expect(runHeadline(prog({ active: 0, needsPerson: 0, sent: 3 }), false)).toBe("Done. Nothing is waiting on you.");
    expect(runHeadline(runProgress([], new Date(T0), T0), false)).toBe("Nothing in this run.");
  });
});
