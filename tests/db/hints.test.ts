import { describe, expect, it } from "vitest";
import { world, type World } from "./world";

const hint = (domain: string, value = "51-200", kind = "headcount") => ({ domain, kind, value });
const set = (w: World, who: "operator" | "admin" | "viewer" | "worker" | "pending", run: string, hints: unknown[]) =>
  w.s[who].query("select public.set_prospect_hints($1, $2::jsonb) as n", [run, JSON.stringify(hints)]);

async function started(domains = ["acme.com", "beta.io"]) {
  const w = await world();
  const run = await w.startRun(domains);
  return { w, run };
}

describe("hints about a company, from Hunter Discover", () => {
  it("are added by an operator or an admin, and nobody else", async () => {
    const { w, run } = await started();
    expect(Number((await set(w, "operator", run, [hint("acme.com")]))[0]!.n)).toBe(1);
    expect(Number((await set(w, "admin", run, [hint("beta.io", "11-50")]))[0]!.n)).toBe(1);
    for (const who of ["viewer", "worker", "pending"] as const) await expect(set(w, who, run, [hint("acme.com")]), who).rejects.toThrow(/Only an operator|permission denied|row-level/);
  });

  it("are stamped with who added them and say they came from Hunter Discover", async () => {
    const { w, run } = await started();
    await set(w, "operator", run, [hint("acme.com", "201-500")]);
    const [r] = await w.db.admin<{ source: string; value: string; created_by: string; kind: string }>("select * from public.prospect_hints");
    expect(r).toMatchObject({ source: "hunter_discover", value: "201-500", kind: "headcount", created_by: w.u.operator });
  });

  it("can only name a company in that run that has not been read yet, so a verdict cannot be changed after the fact", async () => {
    const { w, run } = await started();
    await expect(set(w, "operator", run, [hint("other.com")])).rejects.toThrow(/not been read yet/);
    const [p] = await w.prospects(run);
    await w.s.worker.query("select * from public.claim_next_prospect()");
    await w.db.admin("update public.prospects set step = 'scraped' where id = $1", [p!.id]);
    await expect(set(w, "operator", run, [hint(p!.domain)])).rejects.toThrow(/not been read yet/);
    await expect(set(w, "operator", "00000000-0000-0000-0000-000000000000", [hint("acme.com")])).rejects.toThrow(/Unknown run/);
    expect(await w.db.admin("select * from public.prospect_hints")).toEqual([]);
  });

  it("refuse a band that does not exist, a kind that does not exist, and a list that is not a list or is too long", async () => {
    const { w, run } = await started();
    await expect(set(w, "operator", run, [hint("acme.com", "huge")])).rejects.toThrow(/check constraint|violates/);
    await expect(set(w, "operator", run, [hint("acme.com", "51-200", "revenue")])).rejects.toThrow(/check constraint|violates/);
    await expect(w.s.operator.query("select public.set_prospect_hints($1, '{\"a\":1}'::jsonb)", [run])).rejects.toThrow(/must be a list/);
    await expect(set(w, "operator", run, Array.from({ length: 1001 }, () => hint("acme.com")))).rejects.toThrow(/Too many/);
  });

  it("are one per company, and a repeat is ignored rather than overwriting the first", async () => {
    const { w, run } = await started();
    await set(w, "operator", run, [hint("acme.com", "51-200")]);
    expect(Number((await set(w, "operator", run, [hint("acme.com", "11-50")]))[0]!.n)).toBe(0);
    const rows = await w.db.admin<{ value: string }>("select value from public.prospect_hints");
    expect(rows.map((r) => r.value)).toEqual(["51-200"]);
  });

  it("are append-only, and can be read by anyone who can read, but written by nobody directly", async () => {
    const { w, run } = await started();
    await set(w, "operator", run, [hint("acme.com")]);
    await expect(w.db.admin("update public.prospect_hints set value = '1-10'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.prospect_hints")).rejects.toThrow(/append-only/);
    expect((await w.s.viewer.query("select * from public.prospect_hints")).length).toBe(1);
    expect((await w.s.worker.query("select * from public.prospect_hints")).length).toBe(1);
    expect(await w.s.pending.query("select * from public.prospect_hints")).toEqual([]);
    await expect(w.s.operator.query("insert into public.prospect_hints (run_id, domain, kind, value, source) values ($1, 'acme.com', 'headcount', '1-10', 'hunter_discover')", [run])).rejects.toThrow(/permission denied|row-level/);
  });
});
