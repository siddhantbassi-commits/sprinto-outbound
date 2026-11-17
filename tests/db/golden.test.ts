import { describe, expect, it } from "vitest";
import { world } from "./world";

const row = (over: Record<string, string> = {}) => {
  const v = { trigger: "'manual'", source: "'live'", prompt_version: "'extract-v3'", cases: "10", accuracy: "0.95", wrong_rate: "0.01", verdict_agreement: "0.9", spurious: "0", tokens: "17500", status: "'pass'", ...over };
  return `insert into public.golden_runs (${Object.keys(v).join(", ")}) values (${Object.values(v).join(", ")})`;
};

describe("golden_runs", () => {
  it("lets an operator and the worker record a run, and stamps who and when", async () => {
    const w = await world();
    await w.s.operator.query(row());
    await w.s.worker.query(row({ trigger: "'weekly'" }));
    const rows = await w.db.admin<{ created_by: string | null; trigger: string }>("select created_by, trigger from public.golden_runs order by created_at, trigger");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.trigger === "manual")!.created_by).toBe(w.u.operator);
  });

  it("ignores a back-dated or impersonated stamp", async () => {
    const w = await world();
    await w.s.operator.query("insert into public.golden_runs (trigger, source, prompt_version, cases, accuracy, wrong_rate, verdict_agreement, spurious, tokens, status, created_at, created_by) values ('manual', 'live', 'p', 1, 1, 0, 1, 0, 1, 'pass', '2020-01-01', $1)", [w.u.admin]);
    const [r] = await w.db.admin<{ created_by: string; old: boolean }>("select created_by, created_at < now() - interval '1 day' as old from public.golden_runs");
    expect(r!.old).toBe(false);
    expect(r!.created_by).toBe(w.u.operator);
  });

  it("is readable by a viewer but not writable by one, and invisible to a pending person", async () => {
    const w = await world();
    await w.s.operator.query(row());
    expect(await w.s.viewer.query("select * from public.golden_runs")).toHaveLength(1);
    await expect(w.s.viewer.query(row())).rejects.toThrow(/row-level security|permission denied/);
    expect(await w.s.pending.query("select * from public.golden_runs")).toHaveLength(0);
    await expect(w.s.pending.query(row())).rejects.toThrow(/row-level security|permission denied/);
  });

  it("gives the anonymous role nothing", async () => {
    const w = await world();
    expect(await w.db.as(null, "anon").error("select * from public.golden_runs")).toMatch(/permission denied/);
  });

  it("cannot be rewritten or removed, even by an admin", async () => {
    const w = await world();
    await w.s.operator.query(row());
    await expect(w.s.admin.query("update public.golden_runs set status = 'pass'")).rejects.toThrow(/permission denied/);
    await expect(w.db.admin("update public.golden_runs set status = 'pass'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.golden_runs")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("truncate public.golden_runs")).rejects.toThrow(/append-only/);
  });

  it.each([
    ["an unknown trigger", { trigger: "'sneaky'" }],
    ["an unknown source", { source: "'hand-typed'" }],
    ["an accuracy above 1", { accuracy: "1.5" }],
    ["a negative wrong rate", { wrong_rate: "-0.1" }],
    ["a verdict agreement above 1", { verdict_agreement: "2" }],
    ["no cases", { cases: "0" }],
    ["negative tokens", { tokens: "-5" }],
    ["an unknown status", { status: "'great'" }],
    ["an empty prompt version", { prompt_version: "''" }],
  ])("refuses %s", async (_n, over) => {
    const w = await world();
    await expect(w.s.operator.query(row(over))).rejects.toThrow(/violates check constraint/);
  });

  it("refuses detail that is not a list", async () => {
    const w = await world();
    await expect(w.s.operator.query(row({ detail: "'{}'::jsonb" }))).rejects.toThrow(/violates check constraint/);
  });
});
