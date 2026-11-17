import { describe, expect, it } from "vitest";
import { liveData } from "@/lib/app/queries";
import { pgPort } from "@/lib/db/pg-port";
import { getDemo } from "@/lib/demo/world";
import { computeLive } from "@/lib/quality/live";

describe("live readings over the sample run", () => {
  it("reads real rows, and is honest that a handful of companies cannot be judged", async () => {
    const demo = await getDemo();
    const db = pgPort(demo.db.as(demo.users.viewer));
    const input = await liveData(db, Date.now());
    expect(input.events.length).toBeGreaterThan(0);
    expect(input.impact.prospects.length).toBeGreaterThan(0);
    const live = computeLive(input);
    for (const key of ["scrapeFailure", "groundingFailure", "thinPage", "contactHit", "firstPassLint", "retryRate"]) {
      expect(live.readings.find((r) => r.key === key)!.status, key).toBe("not_enough");
    }
    expect(live.overall).not.toBe("good");
    // The model that did the sample run is named, so a later change can be seen.
    expect(live.models.length).toBeGreaterThan(0);
  }, 60_000);

  it("shows a viewer the same readings an admin sees (nothing here is a contact detail)", async () => {
    const demo = await getDemo();
    const a = await liveData(pgPort(demo.db.as(demo.users.admin)), Date.now());
    const v = await liveData(pgPort(demo.db.as(demo.users.viewer)), Date.now());
    expect(v.events.length).toBe(a.events.length);
  }, 60_000);

  it("shows a pending person nothing", async () => {
    const demo = await getDemo();
    const p = await liveData(pgPort(demo.db.as(demo.users.pending)), Date.now());
    expect(p.events).toHaveLength(0);
    expect(p.impact.prospects).toHaveLength(0);
  }, 60_000);
});
