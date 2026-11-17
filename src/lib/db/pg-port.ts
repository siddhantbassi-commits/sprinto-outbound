import type { DbPort, Row } from "@/lib/db/port";
import type { Session } from "./pglite";

/**
 * The database port over a real Postgres session. It does what PostgREST does: a function call becomes
 * `select * from fn(name => value, ...)`, and objects travel as JSON. The session is a signed-in role, so every row-level
 * security policy and grant applies exactly as it would from the app.
 */
const json = (v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v);
const jsonAll = (v: unknown) => (v === undefined ? null : v instanceof Date ? v.toISOString() : v !== null && typeof v === "object" ? JSON.stringify(v) : v);

export function pgPort(session: Session): DbPort {
  return {
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      return session.query(`select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map((k) => json(args[k])));
    },
    async insert(table, rows: Row | Row[]) {
      const list = Array.isArray(rows) ? rows : [rows];
      const cols = Object.keys(list[0]!);
      const params: unknown[] = [];
      const values = list.map((r) => `(${cols.map((c) => (params.push(jsonAll(r[c])), `$${params.length}`)).join(", ")})`).join(", ");
      return session.query(`insert into public.${table} (${cols.join(", ")}) values ${values} returning *`, params);
    },
    async select(table, where = {}, opts = {}) {
      const keys = Object.keys(where);
      const w = keys.length ? ` where ${keys.map((k, i) => `${k} = $${i + 1}`).join(" and ")}` : "";
      const order = opts.order ? ` order by ${opts.order} ${opts.ascending === false ? "desc" : "asc"}` : "";
      const limit = opts.limit ? ` limit ${Math.trunc(opts.limit)}` : "";
      const offset = opts.offset ? ` offset ${Math.trunc(opts.offset)}` : "";
      if (opts.columns && !/^[a-z_*, ]+$/i.test(opts.columns)) throw new Error("Bad column list");
      return session.query(`select ${opts.columns ?? "*"} from public.${table}${w}${order}${limit}${offset}`, keys.map((k) => json(where[k])));
    },
  };
}
