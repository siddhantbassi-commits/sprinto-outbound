import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * A real Postgres (PGlite, Postgres 18 compiled to WebAssembly) with the project's migrations applied, so the
 * row-level security, the append-only guards and the queue functions are tested for what they actually do.
 * `as()` does what PostgREST does for a signed-in request: switch to the `authenticated` role and set the JWT subject.
 */

const ROOT = process.cwd();
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const SHIM = join(ROOT, "supabase", "dev", "shim.sql");

export type Role = "pending" | "viewer" | "operator" | "admin" | "worker";

export async function newDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(readFileSync(SHIM, "utf8"));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return new Db(pg);
}

export class Db {
  constructor(readonly pg: PGlite) {}

  /** Runs as the database owner (what a migration or the dashboard would do). */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.pg.exec("reset role");
    return (await this.pg.query<T>(sql, params)).rows;
  }

  /** Runs several statements as the owner, in one transaction (so now() is the same for all of them). */
  async exec(sql: string): Promise<void> {
    await this.pg.exec("reset role");
    await this.pg.exec(sql);
  }

  async createUser(email: string, role: Role = "pending"): Promise<string> {
    const [u] = await this.admin<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    if (role !== "pending") await this.admin("update public.profiles set role = $2 where id = $1", [u!.id, role]);
    return u!.id;
  }

  /** A request from a signed-in person. */
  as(userId: string | null, asRole: "authenticated" | "anon" = "authenticated"): Session {
    return new Session(this.pg, userId, asRole);
  }

  /** A request from the service role, which bypasses row-level security. */
  service(): Session {
    return new Session(this.pg, null, "service_role");
  }
}

export class Session {
  constructor(
    private readonly pg: PGlite,
    private readonly userId: string | null,
    private readonly dbRole: string,
  ) {}

  private async enter() {
    await this.pg.exec("reset role");
    await this.pg.query("select set_config('request.jwt.claim.sub', $1, false)", [this.userId ?? ""]);
    await this.pg.exec(`set role ${this.dbRole}`);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.enter();
    try {
      return (await this.pg.query<T>(sql, params)).rows;
    } finally {
      await this.pg.exec("reset role");
    }
  }

  /** The error message a statement raises, or null if it succeeds. */
  async error(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await this.query(sql, params);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Calls a function the way PostgREST's rpc does: `select * from fn(args)`. */
  async rpc<T = Record<string, unknown>>(fn: string, args: unknown[] = []): Promise<T[]> {
    const marks = args.map((_, i) => `$${i + 1}`).join(", ");
    return this.query<T>(`select * from public.${fn}(${marks})`, args);
  }
}
