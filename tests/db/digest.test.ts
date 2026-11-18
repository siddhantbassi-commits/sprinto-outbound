import { describe, expect, it } from "vitest";
import { world } from "./world";

const CRIT = JSON.stringify({ regions: ["AMER"], sizes: ["51-200"], angles: ["software"], want: 5 });
const save = (w: Awaited<ReturnType<typeof world>>, who: "operator" | "admin" | "viewer" | "worker" | "pending", enabled = true, reason = "Weekly search") =>
  w.s[who].query("select * from public.set_digest_search($1::jsonb, $2, $3)", [CRIT, enabled, reason]);
const record = (w: Awaited<ReturnType<typeof world>>, who: "operator" | "admin" | "viewer" | "worker" | "pending", status = "sent", trigger = "cron", found = "[]") =>
  w.s[who].query("select * from public.record_digest($1, $2::jsonb, 10, $3::jsonb, '{}'::jsonb, '[]'::jsonb, $4, '')", [trigger, CRIT, found, status]);

describe("the saved weekly search", () => {
  it("is changed by an operator or an admin, with a reason, and by nobody else", async () => {
    const w = await world();
    await save(w, "operator");
    await save(w, "admin", false, "Paused while we change the ICP");
    for (const who of ["viewer", "worker", "pending"] as const) await expect(save(w, who), who).rejects.toThrow(/Only an operator|permission denied|row-level/);
    await expect(save(w, "operator", true, "  ")).rejects.toThrow(/reason is required/);
    await expect(w.s.operator.query("select * from public.set_digest_search('[1]'::jsonb, true, 'x y z')")).rejects.toThrow(/not valid/);
    const rows = await w.db.admin<{ enabled: boolean; version: number; created_by: string }>("select * from public.digest_searches order by version");
    expect(rows.map((r) => r.enabled)).toEqual([true, false]);
    expect(rows[0]!.created_by).toBe(w.u.operator);
  });

  it("keeps every version: the newest decides, and nothing can be edited or removed", async () => {
    const w = await world();
    await save(w, "operator", true);
    await save(w, "operator", false);
    expect((await w.db.admin<{ enabled: boolean }>("select enabled from public.digest_searches order by version desc limit 1"))[0]!.enabled).toBe(false);
    await expect(w.db.admin("update public.digest_searches set enabled = true")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.digest_searches")).rejects.toThrow(/append-only/);
  });

  it("lets a viewer read it and gives nobody a way to write except the function", async () => {
    const w = await world();
    await save(w, "operator");
    expect((await w.s.viewer.query("select * from public.digest_searches")).length).toBe(1);
    expect(await w.s.pending.query("select * from public.digest_searches")).toEqual([]);
    await expect(w.s.operator.query("insert into public.digest_searches (enabled, criteria, reason) values (true, '{}', 'sneaky')")).rejects.toThrow(/permission denied|row-level/);
  });
});

describe("recording a digest", () => {
  it("is allowed to the worker and to people who can run work, not to a viewer or someone not yet approved", async () => {
    const w = await world();
    await record(w, "worker");
    await record(w, "operator", "skipped", "browser");
    for (const who of ["viewer", "pending"] as const) await expect(record(w, who), who).rejects.toThrow(/Not allowed|permission denied|row-level/);
    expect((await w.db.admin("select * from public.digests")).length).toBe(2);
  });

  it("is append-only, stamped, and readable by a viewer; nobody can write a row directly", async () => {
    const w = await world();
    await record(w, "worker", "sent", "cron", JSON.stringify([{ domain: "a.io", name: "A" }]));
    const [d] = await w.db.admin<{ created_by: string; found: { domain: string }[]; trigger: string }>("select * from public.digests");
    expect(d!.created_by).toBe(w.u.worker);
    expect(d!.found[0]!.domain).toBe("a.io");
    await expect(w.db.admin("update public.digests set email_status = 'failed'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.digests")).rejects.toThrow(/append-only/);
    expect((await w.s.viewer.query("select * from public.digests")).length).toBe(1);
    await expect(w.s.worker.query("insert into public.digests (trigger, criteria, email_status) values ('cron', '{}', 'sent')")).rejects.toThrow(/permission denied|row-level/);
  });

  it("refuses an unknown trigger or email status, and a list that is not a list or is too long", async () => {
    const w = await world();
    await expect(record(w, "worker", "sent", "magic")).rejects.toThrow(/check constraint|violates/);
    await expect(record(w, "worker", "maybe")).rejects.toThrow(/check constraint|violates/);
    await expect(record(w, "worker", "sent", "cron", '{"a":1}')).rejects.toThrow(/check constraint|violates/);
    await expect(record(w, "worker", "sent", "cron", JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ domain: `d${i}.io` }))))).rejects.toThrow(/check constraint|violates/);
    expect(await w.db.admin("select * from public.digests")).toEqual([]);
  });
});
