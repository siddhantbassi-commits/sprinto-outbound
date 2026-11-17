/**
 * The only thing the worker knows about the database: call a function, insert a row, read rows. In production this is
 * Supabase's client (PostgREST `rpc`, `insert`, `select`) signed in as the worker's own account; in tests it is a
 * real Postgres behind the same three calls. Functions take named arguments, exactly as PostgREST passes them.
 */
export type Row = Record<string, unknown>;

export interface SelectOptions {
  order?: string;
  ascending?: boolean;
  limit?: number;
  /** Rows to skip. Needs an order to be meaningful. */
  offset?: number;
  /** Which columns to read, comma separated. Defaults to all. Use it to avoid pulling large text you do not need. */
  columns?: string;
}

export interface DbPort {
  /** Calls a database function. Always returns rows: a scalar function returns one row. */
  rpc(fn: string, args?: Row): Promise<Row[]>;
  insert(table: string, rows: Row | Row[]): Promise<Row[]>;
  select(table: string, where?: Row, opts?: SelectOptions): Promise<Row[]>;
}

/** A database function raised an error with this message (for example "lease_lost"). */
export class DbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbError";
  }
}
