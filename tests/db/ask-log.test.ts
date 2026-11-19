import { describe, expect, it } from "vitest";
import { world } from "./world";

const log = (w: Awaited<ReturnType<typeof world>>, who: "operator" | "admin" | "viewer" | "worker" | "pending", tokens = 0) => w.s[who].query("select public.log_ask($1::int)", [tokens]);

describe("counting questions on the Ask page", () => {
  it("lets an operator or an admin log a question, and nobody else", async () => {
    const w = await world();
    await log(w, "operator", 1200);
    await log(w, "admin");
    for (const who of ["viewer", "worker", "pending"] as const) await expect(log(w, who), who).rejects.toThrow(/Only an operator|permission denied|row-level/);
    expect((await w.db.admin("select * from public.ask_log")).length).toBe(2);
  });

  it("stamps who asked and when, and keeps the history: nothing can be edited or removed", async () => {
    const w = await world();
    await log(w, "operator", 500);
    const [row] = await w.db.admin<{ created_by: string; created_at: string; tokens: number }>("select * from public.ask_log");
    expect(row!.created_by).toBe(w.u.operator);
    expect(row!.created_at).toBeTruthy();
    expect(row!.tokens).toBe(500);
    await expect(w.db.admin("update public.ask_log set tokens = 0")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.ask_log")).rejects.toThrow(/append-only/);
  });

  it("gives nobody a way in except the function, and lets a signed-in reader count", async () => {
    const w = await world();
    await log(w, "operator");
    await expect(w.s.operator.query("insert into public.ask_log (tokens) values (1)")).rejects.toThrow(/permission denied|row-level/);
    expect((await w.s.viewer.query("select * from public.ask_log")).length).toBe(1);
    expect(await w.s.pending.query("select * from public.ask_log")).toEqual([]);
  });

  it("keeps a sane token figure whatever it is handed", async () => {
    const w = await world();
    await log(w, "operator", -50);
    await log(w, "operator", 99_999_999);
    const rows = await w.db.admin<{ tokens: number }>("select tokens from public.ask_log order by id");
    expect(rows.map((r) => r.tokens)).toEqual([0, 1_000_000]);
  });
});
