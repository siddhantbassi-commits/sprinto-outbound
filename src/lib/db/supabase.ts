import { DbError, type DbPort, type Row } from "./port";

/**
 * The database port over Supabase (PostgREST). Written against the small shape of the client it needs, so it carries
 * no dependency of its own and is tested with a fake. Every call runs as whoever the client is signed in as, so the
 * database's row-level security and grants apply exactly as they do to a person.
 */

interface Result {
  data: unknown;
  error: { message: string } | null;
}
type Thenable = PromiseLike<Result>;

export interface QueryLike extends Thenable {
  select(columns?: string): QueryLike;
  eq(column: string, value: unknown): QueryLike;
  order(column: string, opts?: { ascending?: boolean }): QueryLike;
  limit(n: number): QueryLike;
  range(from: number, to: number): QueryLike;
}
export interface SupabaseLike {
  rpc(fn: string, args?: Row): Thenable;
  from(table: string): { insert(rows: Row | Row[]): QueryLike; select(columns?: string): QueryLike };
}

/**
 * Functions that return one value rather than a row or rows. PostgREST hands such a value back bare (a jsonb result
 * arrives as the object itself), which would be mistaken for a row, so these are wrapped the way a SQL `select * from fn()`
 * shows them: one row with one column named after the function. The test suite checks this list against the database.
 */
export const SCALAR_FUNCTIONS = new Set([
  "create_run", "extend_lease", "release_prospect", "reserve_send", "sweep_stuck_sends", "record_tick", "run_retention", "run_tokens",
  "is_suppressed", "run_is_paused", "holds_lease", "current_app_role", "can_read", "can_work", "is_human_operator", "is_admin", "is_valid_domain", "set_prospect_hints", "log_ask",
]);

const fail = (what: string, e: { message: string }) => new DbError(`${what}: ${e.message}`);

export function supabasePort(client: SupabaseLike): DbPort {
  return {
    async rpc(fn, args = {}) {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new DbError(error.message);
      if (SCALAR_FUNCTIONS.has(fn)) return [{ [fn]: data ?? null }];
      if (data === null || data === undefined) return [];
      return Array.isArray(data) ? (data as Row[]) : [data as Row];
    },

    async insert(table, rows) {
      const { data, error } = await client.from(table).insert(rows).select();
      if (error) throw fail(`Could not write to ${table}`, error);
      return (data ?? []) as Row[];
    },

    async select(table, where = {}, opts = {}) {
      let q = client.from(table).select(opts.columns ?? "*");
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false });
      if (opts.offset && opts.limit) q = q.range(opts.offset, opts.offset + opts.limit - 1);
      else if (opts.limit) q = q.limit(opts.limit);
      const { data, error } = await q;
      if (error) throw fail(`Could not read ${table}`, error);
      return (data ?? []) as Row[];
    },
  };
}
