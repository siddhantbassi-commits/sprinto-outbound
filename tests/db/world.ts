import { newDb, type Db, type Session } from "./harness";

export const TEST_TO = "me@example.com";

export interface World {
  db: Db;
  u: Record<"admin" | "operator" | "viewer" | "pending" | "worker" | "worker2", string>;
  s: Record<"admin" | "operator" | "viewer" | "pending" | "worker" | "worker2", Session>;
  /** An operator starts a run; returns the run id. */
  startRun(domains: string[]): Promise<string>;
  /** Claims the next prospect as the given worker and returns it (or undefined). */
  claim(who?: "worker" | "worker2", lease?: number): Promise<Prospect | undefined>;
  prospects(runId?: string): Promise<Prospect[]>;
  /** Walks one claimed prospect up to a step by advancing it, re-claiming between steps. */
  walkTo(domain: string, step: string, who?: "worker" | "worker2"): Promise<Prospect>;
  /** Takes a prospect to 'drafted' with an email row, and leaves it claimed at 'drafted' by `who`. */
  toDrafted(domain: string, who?: "worker" | "worker2"): Promise<{ prospect: Prospect; emailId: string }>;
  settings(patch: Record<string, string | number | boolean | null>): Promise<void>;
}

export interface Prospect {
  id: string;
  run_id: string;
  domain: string;
  step: string;
  lane: string;
  lane_reason: string | null;
  attempts: number;
  next_run_at: string;
  leased_by: string | null;
  lease_until: string | null;
  last_error: string | null;
  score: number | null;
  verdict: string | null;
}

const ORDER = ["queued", "scraped", "qualified", "contact_found", "pains_chosen", "drafted"];

export async function world(opts: { configure?: boolean; signoff?: boolean } = {}): Promise<World> {
  const db = await newDb();
  const u = {
    admin: await db.createUser("admin@example.com", "admin"),
    operator: await db.createUser("operator@example.com", "operator"),
    viewer: await db.createUser("viewer@example.com", "viewer"),
    pending: await db.createUser("pending@example.com", "pending"),
    worker: await db.createUser("worker@example.com", "worker"),
    worker2: await db.createUser("worker2@example.com", "worker"),
  };
  const s = Object.fromEntries(Object.entries(u).map(([k, id]) => [k, db.as(id)])) as World["s"];

  const w: World = {
    db,
    u,
    s,
    async settings(patch) {
      const [cur] = await s.admin.query<Record<string, unknown>>("select * from public.settings_now()");
      const next = { ...cur, ...patch };
      const cols = ["test_to", "sender_name", "sender_title", "postal_address", "daily_send_cap", "max_run_size", "max_parallel", "hunter_reserve", "tokens_per_domain", "tokens_per_run", "mail_cooldown_days", "minutes_saved_per_email", "review_minutes_per_email", "review_minutes_per_decision", "require_approval"];
      await s.admin.query(
        `insert into public.settings_versions (${cols.join(", ")}, reason) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}, 'test change')`,
        cols.map((c) => next[c]),
      );
    },
    async startRun(domains) {
      const [r] = await s.operator.query<{ create_run: string }>("select public.create_run($1::text[], 'paste', 'test', '{}'::jsonb)", [domains]);
      return r!.create_run;
    },
    async claim(who = "worker", lease = 120) {
      const rows = await s[who].query<Prospect>("select * from public.claim_next_prospect($1)", [lease]);
      return rows[0];
    },
    async prospects(runId) {
      return db.admin<Prospect>(runId ? "select * from public.prospects where run_id = $1 order by domain" : "select * from public.prospects order by domain", runId ? [runId] : []);
    },
    async walkTo(domain, step, who = "worker") {
      for (;;) {
        const [cur] = await db.admin<Prospect>("select * from public.prospects where domain = $1 order by created_at desc limit 1", [domain]);
        if (cur!.step === step) return cur!;
        // Claim specifically this domain by making it the only due one.
        await db.admin("update public.prospects set next_run_at = now() - interval '1 hour' where id = $1", [cur!.id]);
        await db.admin("update public.prospects set next_run_at = now() + interval '1 hour' where id <> $1 and lane = 'active' and lease_until is null", [cur!.id]);
        const got = await w.claim(who);
        if (!got || got.id !== cur!.id) throw new Error(`Could not claim ${domain}`);
        await s[who].query("select * from public.advance_prospect($1, $2)", [got.id, got.step]);
        if (ORDER.indexOf(got.step) + 1 === ORDER.indexOf(step)) {
          const [done] = await db.admin<Prospect>("select * from public.prospects where id = $1", [got.id]);
          return done!;
        }
      }
    },
    async toDrafted(domain, who = "worker") {
      await w.walkTo(domain, "pains_chosen", who);
      const [cur] = await db.admin<Prospect>("select * from public.prospects where domain = $1 order by created_at desc limit 1", [domain]);
      await db.admin("update public.prospects set next_run_at = now() - interval '1 hour' where id = $1", [cur!.id]);
      await db.admin("update public.prospects set next_run_at = now() + interval '1 hour' where id <> $1 and lane = 'active' and lease_until is null", [cur!.id]);
      const got = await w.claim(who);
      const [email] = await s[who].query<{ id: string }>(
        "insert into public.emails (prospect_id, domain, subject, body, lint) values ($1, 'ignored.example', 'Subject', 'Body', '[]') returning id",
        [got!.id],
      );
      await s[who].query("select * from public.advance_prospect($1, 'pains_chosen')", [got!.id]);
      await db.admin("update public.prospects set next_run_at = now() - interval '1 hour' where id = $1", [cur!.id]);
      const again = await w.claim(who);
      return { prospect: again!, emailId: email!.id };
    },
  };

  if (opts.configure !== false) {
    await s.admin.query(
      "insert into public.settings_versions (test_to, sender_name, sender_title, postal_address, require_approval, reason) values ($1, 'Sid', 'Growth Lead', '1 Example Street', false, 'test setup')",
      [TEST_TO],
    );
  }
  if (opts.signoff !== false) {
    const [v] = await s.admin.query<{ id: string }>("select id from public.icp_versions order by version desc limit 1");
    await s.admin.query("insert into public.icp_signoffs (icp_version_id, note) values ($1, 'ok')", [v!.id]);
  }
  return w;
}
