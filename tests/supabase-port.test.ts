import { describe, expect, it } from "vitest";
import { selectAll } from "@/lib/db/all";
import { DbError, type DbPort } from "@/lib/db/port";
import { SCALAR_FUNCTIONS, supabasePort, type QueryLike, type SupabaseLike } from "@/lib/db/supabase";
import { newDb } from "@/lib/db/pglite";

type Call = { op: string; args: unknown[] };

/** A fake PostgREST client that records the calls it is given and answers from a script. */
function fake(answer: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: Call[] = [];
  const result = { data: answer.data ?? null, error: answer.error ?? null };
  const query = (): QueryLike => {
    const q: QueryLike = {
      select: (...a) => (calls.push({ op: "select", args: a }), q),
      eq: (...a) => (calls.push({ op: "eq", args: a }), q),
      order: (...a) => (calls.push({ op: "order", args: a }), q),
      limit: (...a) => (calls.push({ op: "limit", args: a }), q),
      range: (...a) => (calls.push({ op: "range", args: a }), q),
      then: (f, r) => Promise.resolve(result).then(f, r),
    } as QueryLike;
    return q;
  };
  const client: SupabaseLike = {
    rpc: (fn, args) => (calls.push({ op: "rpc", args: [fn, args] }), Promise.resolve(result)),
    from: (table) => ({
      insert: (rows) => (calls.push({ op: "insert", args: [table, rows] }), query()),
      select: (cols) => (calls.push({ op: "from.select", args: [table, cols] }), query()),
    }),
  };
  return { client, calls };
}

describe("supabasePort.rpc", () => {
  it("passes named arguments straight through", async () => {
    const f = fake({ data: [] });
    await supabasePort(f.client).rpc("claim_next_prospect", { p_lease_seconds: 120 });
    expect(f.calls[0]).toEqual({ op: "rpc", args: ["claim_next_prospect", { p_lease_seconds: 120 }] });
  });

  it("returns rows for a set-returning function and a composite row for a single-row one", async () => {
    expect(await supabasePort(fake({ data: [{ id: "a" }, { id: "b" }] }).client).rpc("claim_next_prospect")).toEqual([{ id: "a" }, { id: "b" }]);
    expect(await supabasePort(fake({ data: { id: "s1", test_to: null } }).client).rpc("settings_now")).toEqual([{ id: "s1", test_to: null }]);
    expect(await supabasePort(fake({ data: null }).client).rpc("claim_next_prospect")).toEqual([]);
  });

  it("wraps a bare scalar, so a jsonb object is not mistaken for a row", async () => {
    const jsonb = { ok: true, test_to: "me@example.com" };
    expect(await supabasePort(fake({ data: jsonb }).client).rpc("reserve_send", { p_email: "e" })).toEqual([{ reserve_send: jsonb }]);
    expect(await supabasePort(fake({ data: 3 }).client).rpc("sweep_stuck_sends")).toEqual([{ sweep_stuck_sends: 3 }]);
    expect(await supabasePort(fake({ data: false }).client).rpc("is_suppressed", {})).toEqual([{ is_suppressed: false }]);
    expect(await supabasePort(fake({ data: null }).client).rpc("record_tick")).toEqual([{ record_tick: null }]);
  });

  it("raises the database's message as a DbError, so a lost lease is recognisable", async () => {
    const p = supabasePort(fake({ error: { message: "lease_lost" } }).client);
    const err = await p.rpc("advance_prospect", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbError);
    expect((err as Error).message).toBe("lease_lost");
  });
});

describe("supabasePort.insert and select", () => {
  it("inserts and asks for the rows back", async () => {
    const f = fake({ data: [{ id: "x" }] });
    expect(await supabasePort(f.client).insert("pages", [{ url: "u" }])).toEqual([{ id: "x" }]);
    expect(f.calls.map((c) => c.op)).toEqual(["insert", "select"]);
  });

  it("filters by equality, orders and limits", async () => {
    const f = fake({ data: [{ n: 1 }] });
    await supabasePort(f.client).select("emails", { prospect_id: "p", status: "sent" }, { order: "attempt", ascending: false, limit: 2 });
    expect(f.calls.map((c) => [c.op, ...c.args])).toEqual([["from.select", "emails", "*"], ["eq", "prospect_id", "p"], ["eq", "status", "sent"], ["order", "attempt", { ascending: false }], ["limit", 2]]);
  });

  it("reads only the columns asked for, and pages with range when given an offset", async () => {
    const f = fake({ data: [] });
    await supabasePort(f.client).select("pages", { prospect_id: "p" }, { columns: "prospect_id,thin", order: "created_at", limit: 1000, offset: 2000 });
    expect(f.calls.map((c) => [c.op, ...c.args])).toEqual([["from.select", "pages", "prospect_id,thin"], ["eq", "prospect_id", "p"], ["order", "created_at", { ascending: true }], ["range", 2000, 2999]]);
  });

  it("returns an empty list for no data and names the table in an error", async () => {
    expect(await supabasePort(fake({ data: null }).client).select("runs")).toEqual([]);
    await expect(supabasePort(fake({ error: { message: "permission denied" } }).client).select("runs")).rejects.toThrow("Could not read runs: permission denied");
    await expect(supabasePort(fake({ error: { message: "row-level security" } }).client).insert("pages", {})).rejects.toThrow("Could not write to pages: row-level security");
  });
});

describe("the scalar-function list matches the database", () => {
  it("names exactly the functions whose declared return type is not a row or a set of rows", async () => {
    const db = await newDb();
    const rows = await db.admin<{ proname: string; kind: string }>(
      `select p.proname, case when p.proretset then 'set' when t.typtype = 'c' then 'composite' else 'scalar' end kind
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
       where n.nspname = 'public' and p.prokind = 'f' and p.proname not like '\\_%' and p.prorettype <> 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')`,
    );
    const scalarInDb = new Set(rows.filter((r) => r.kind === "scalar").map((r) => r.proname));
    // jsonb and void are scalar here too; composites (settings_now, hunter_cached, prospects) are rows.
    expect([...scalarInDb].sort()).toEqual([...SCALAR_FUNCTIONS].sort());
  });
});

describe("selectAll (reading past the server's row cap)", () => {
  /** A fake database of n rows whose server never returns more than `cap` rows per request, like PostgREST's max-rows. */
  const server = (n: number, cap: number) => {
    const asked: { limit: number; offset: number }[] = [];
    const db: DbPort = {
      rpc: async () => [],
      insert: async () => [],
      select: async (_t, _w, o = {}) => {
        asked.push({ limit: o.limit ?? 0, offset: o.offset ?? 0 });
        const from = o.offset ?? 0;
        return Array.from({ length: Math.max(0, Math.min(o.limit ?? cap, cap, n - from)) }, (_, i) => ({ i: from + i }));
      },
    };
    return { db, asked };
  };

  it("reads every row of a table bigger than one page, in order, with no gaps or repeats", async () => {
    const { db } = server(2600, 1000);
    const rows = await selectAll(db, "prospects", {}, { order: "created_at" });
    expect(rows).toHaveLength(2600);
    expect(rows.map((r) => r.i)).toEqual(Array.from({ length: 2600 }, (_, i) => i));
  });

  it("does not stop early when the server's own cap is smaller than the page asked for", async () => {
    const { db } = server(2600, 400);
    expect(await selectAll(db, "prospects", {}, { order: "created_at" })).toHaveLength(2600);
  });

  it("stops at max, and on an empty table makes one request", async () => {
    const big = server(5000, 1000);
    expect(await selectAll(big.db, "t", {}, { order: "id" }, 1500)).toHaveLength(1500);
    const empty = server(0, 1000);
    expect(await selectAll(empty.db, "t", {}, { order: "id" })).toEqual([]);
    expect(empty.asked).toHaveLength(1);
  });

  it("passes the filter and the column list through, and asks for no more than max at the end", async () => {
    const seen: unknown[] = [];
    const db: DbPort = { rpc: async () => [], insert: async () => [], select: async (t, w, o) => (seen.push([t, w, o]), []) };
    await selectAll(db, "emails", { status: "sent" }, { order: "created_at", columns: "id,status" }, 20_000);
    expect(seen).toEqual([["emails", { status: "sent" }, { order: "created_at", columns: "id,status", limit: 1000, offset: 0 }]]);
  });
});
