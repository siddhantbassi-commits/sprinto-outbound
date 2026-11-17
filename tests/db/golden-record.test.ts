import { describe, expect, it } from "vitest";
import { goldenOracle } from "@/lib/quality/harness";
import { COOLDOWN_MS, currentIcp, goldenRuns, runAndRecord } from "@/lib/quality/record";
import { ICP_V1 } from "@/lib/icp/config";
import { pgPort } from "./pgport";
import { world } from "./world";

describe("running and recording the golden set", () => {
  it("keeps a row that matches the run, under the signed-off ICP version", async () => {
    const w = await world();
    const db = pgPort(w.s.operator);
    const r = await runAndRecord({ db, ai: goldenOracle(), source: "scripted", trigger: "manual" });
    expect(r.ok).toBe(true);
    const [row] = await goldenRuns(db);
    expect(row).toMatchObject({ trigger: "manual", source: "scripted", status: "pass", accuracy: 1, wrong_rate: 0, verdict_agreement: 1, spurious: 0, models: ["golden-oracle"] });
    expect(row!.cases).toBeGreaterThanOrEqual(10);
    expect(row!.tokens).toBeGreaterThan(0);
    expect(row!.detail).toHaveLength(row!.cases);
    const icp = await currentIcp(db);
    expect(icp.id).not.toBeNull();
    expect(row!.icp_version_id).toBe(icp.id);
  });

  it("records a failing run honestly, with the reasons and the cases that went wrong", async () => {
    const w = await world();
    const db = pgPort(w.s.operator);
    const bad = goldenOracle(undefined, { wrong: ["compliance", "headcount", "product", "customerData"] });
    const r = await runAndRecord({ db, ai: bad, source: "live", trigger: "weekly" });
    expect(r.ok && r.run.summary.status).toBe("fail");
    const [row] = await goldenRuns(db);
    expect(row).toMatchObject({ status: "fail", source: "live", trigger: "weekly" });
    expect(row!.reasons.length).toBeGreaterThan(0);
    expect(row!.detail.some((c) => c.mismatches.some((m) => m.outcome === "wrong"))).toBe(true);
  });

  it("refuses a second run inside the cooldown, and allows one after", async () => {
    const w = await world();
    const db = pgPort(w.s.operator);
    expect((await runAndRecord({ db, ai: goldenOracle(), source: "scripted", trigger: "manual" })).ok).toBe(true);
    const again = await runAndRecord({ db, ai: goldenOracle(), source: "scripted", trigger: "manual" });
    expect(again).toMatchObject({ ok: false });
    expect(await goldenRuns(db)).toHaveLength(1);
    const later = await runAndRecord({ db, ai: goldenOracle(), source: "scripted", trigger: "manual", now: Date.now() + COOLDOWN_MS + 1000 });
    expect(later.ok).toBe(true);
    expect(await goldenRuns(db)).toHaveLength(2);
  });

  it("lets the worker record the weekly run, and a viewer read it but not record one", async () => {
    const w = await world();
    expect((await runAndRecord({ db: pgPort(w.s.worker), ai: goldenOracle(), source: "scripted", trigger: "weekly" })).ok).toBe(true);
    expect(await goldenRuns(pgPort(w.s.viewer))).toHaveLength(1);
    await expect(runAndRecord({ db: pgPort(w.s.viewer), ai: goldenOracle(), source: "scripted", trigger: "manual", now: Date.now() + COOLDOWN_MS * 2 })).rejects.toThrow();
  });

  it("falls back to the built-in rubric, and says so, when nothing is signed off", async () => {
    const w = await world({ signoff: false });
    const db = pgPort(w.s.operator);
    expect((await currentIcp(db)).id).toBeNull();
    await runAndRecord({ db, ai: goldenOracle(), source: "scripted", trigger: "manual" });
    expect((await goldenRuns(db))[0]!.icp_version_id).toBeNull();
  });

  it("scores the fixtures under the ICP in force, so a changed rubric changes what is expected", async () => {
    const w = await world();
    const db = pgPort(w.s.operator);
    const strict = { ...ICP_V1, qualifyAt: 100, maybeAt: 99, version: 2 };
    await w.s.admin.query("insert into public.icp_versions (config, blocklist, reason) values ($1, '{}', 'much stricter')", [JSON.stringify(strict)]);
    const [v] = await w.db.admin<{ id: string }>("select id from public.icp_versions where (config->>'version')::int = 2");
    await w.s.admin.query("insert into public.icp_signoffs (icp_version_id, note) values ($1, 'ok')", [v!.id]);
    await runAndRecord({ db, ai: goldenOracle(), source: "scripted", trigger: "manual" });
    const row = (await goldenRuns(db))[0]!;
    expect(row.icp_version_id).toBe(v!.id);
    expect(row.detail.find((c) => c.id === "strong-saas")!.verdict.expected).not.toBe("qualified");
    // The same model still agrees with itself: the expectation moved with the rubric.
    expect(row.verdict_agreement).toBe(1);
  });

  it("lists newest first", async () => {
    const w = await world();
    const db = pgPort(w.s.operator);
    await runAndRecord({ db, ai: goldenOracle(), source: "scripted", trigger: "manual" });
    await runAndRecord({ db, ai: goldenOracle(undefined, { drop: ["compliance"] }), source: "live", trigger: "manual", now: Date.now() + COOLDOWN_MS + 5000 });
    const rows = await goldenRuns(db);
    expect(rows.map((r) => r.source)).toEqual(["live", "scripted"]);
  });
});
