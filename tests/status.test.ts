import { describe, expect, it } from "vitest";
import { getDemo } from "@/lib/demo/world";
import { pgPort } from "@/lib/db/pg-port";
import { runStatuses } from "@/lib/app/status";

describe("run statuses (what the progress card and the finish notice read)", () => {
  it("reports the finished sample run as finished, with who is worth a call and who needs a person", async () => {
    const w = await getDemo();
    const statuses = await runStatuses(pgPort(w.db.as(w.users.operator)));
    const sample = statuses.find((s) => s.title === "Sample run")!;
    expect(sample).toMatchObject({ finished: true, percent: 100, active: 0, remainingSeconds: null, doing: null, paused: false });
    expect(sample.qualified).toBeGreaterThanOrEqual(2);
    expect(sample.sent).toBeGreaterThanOrEqual(2);
    expect(sample.lastStepAt).toBeTruthy();
  }, 60_000);

  it("reports a run with work left as running, with a time to go and what is being done", async () => {
    const w = await getDemo();
    const db = pgPort(w.db.as(w.users.operator));
    await db.rpc("create_run", { p_domains: ["meridiancare.io", "tesseldata.com"], p_source: "discover", p_note: "Fresh", p_prompt_versions: {} });
    const fresh = (await runStatuses(db)).find((s) => s.title === "Fresh")!;
    expect(fresh).toMatchObject({ finished: false, active: 2, total: 2, percent: 0, doing: "Reading the websites", stageIndex: 0, paused: false });
    expect(fresh.remainingSeconds).toBeGreaterThan(0);
  }, 60_000);

  it("never calls a paused run finished, and flags it as paused", async () => {
    const w = await getDemo();
    const db = pgPort(w.db.as(w.users.operator));
    const [run] = await w.db.admin<{ id: string }>("select id from public.runs where note = 'Fresh'");
    await db.insert("decisions", { run_id: run!.id, kind: "pause_run", reason: "testing the card" });
    const s = (await runStatuses(db)).find((x) => x.title === "Fresh")!;
    expect(s).toMatchObject({ paused: true, finished: false });
  }, 60_000);

  it("lists the newest runs first and no more than asked", async () => {
    const w = await getDemo();
    const all = await runStatuses(pgPort(w.db.as(w.users.operator)), 2);
    expect(all).toHaveLength(2);
    expect(new Date(all[0]!.startedAt).getTime()).toBeGreaterThanOrEqual(new Date(all[1]!.startedAt).getTime());
  }, 60_000);
});
