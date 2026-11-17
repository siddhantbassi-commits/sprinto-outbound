import { describe, expect, it } from "vitest";
import { world } from "./world";

const ALL_TABLES = [
  "profiles", "settings_versions", "icp_versions", "icp_signoffs", "sprinto_facts_versions", "runs", "prospects", "step_events", "pages", "facts",
  "scores", "contacts", "manual_contacts", "hunter_cache", "emails", "suppressions", "decisions", "usage_ledger", "worker_ticks", "role_changes", "golden_runs",
];

describe("every table is locked down", () => {
  it("has row-level security on every public table", async () => {
    const w = await world();
    const rows = await w.db.admin<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...ALL_TABLES].sort());
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("gives the anonymous and service roles no privilege on any table or sequence", async () => {
    const w = await world();
    const grants = await w.db.admin<{ grantee: string; table_name: string; privilege_type: string }>(
      "select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'service_role', 'PUBLIC')",
    );
    expect(grants).toEqual([]);
  });

  it("lets nobody delete, truncate or update through the API roles", async () => {
    const w = await world();
    const grants = await w.db.admin<{ table_name: string; privilege_type: string }>(
      "select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('DELETE', 'TRUNCATE', 'UPDATE', 'REFERENCES', 'TRIGGER') order by 1, 2",
    );
    expect(grants).toEqual([]);
    const cols = await w.db.admin<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.column_privileges where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1, 2",
    );
    expect(cols).toEqual([]);
  });

  it("pins the search path on every security-definer function", async () => {
    const w = await world();
    const loose = await w.db.admin<{ proname: string }>("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))");
    expect(loose).toEqual([]);
  });

  it("keeps every function and procedure away from the anonymous role and the public, and the internal ones away from signed-in users", async () => {
    const w = await world();
    const fns = await w.db.admin<{ proname: string; anon: boolean; pub: boolean; authed: boolean }>(
      "select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('public', p.oid, 'execute') pub, has_function_privilege('authenticated', p.oid, 'execute') authed from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')",
    );
    expect(fns.filter((f) => f.anon || f.pub).map((f) => f.proname)).toEqual([]);
    for (const f of fns.filter((f) => f.proname.startsWith("_"))) expect(f.authed, f.proname).toBe(false);
  });
});

describe("the anonymous role", () => {
  it("cannot read any table or call any function", async () => {
    const w = await world();
    const anon = w.db.as(null, "anon");
    for (const t of ALL_TABLES) expect(await anon.error(`select * from public.${t}`), t).toMatch(/permission denied/);
    expect(await anon.error("select * from public.claim_next_prospect()")).toMatch(/permission denied/);
    expect(await anon.error("select public.create_run('{a.com}', 'paste', '', '{}')")).toMatch(/permission denied/);
  });
});

describe("the service role is no back door", () => {
  it("has no table privileges, even though it bypasses row-level security", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const svc = w.db.service();
    expect(await svc.error("select * from public.prospects")).toMatch(/permission denied/);
    expect(await svc.error("update public.step_events set status = 'ok'")).toMatch(/permission denied/);
    expect(await svc.error("delete from public.runs")).toMatch(/permission denied/);
  });
});

describe("roles", () => {
  it("shows a pending person nothing and lets them do nothing", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    for (const t of ["runs", "prospects", "step_events", "settings_versions", "suppressions"]) expect(await w.s.pending.query(`select * from public.${t}`), t).toEqual([]);
    expect(await w.s.pending.error("select public.create_run('{b.com}', 'paste', '', '{}')")).toMatch(/Only an operator/);
    expect(await w.s.pending.error("select * from public.claim_next_prospect()")).toMatch(/Not allowed/);
    expect(await w.s.pending.query("select * from public.profiles")).toHaveLength(1);
  });

  it("lets a viewer read, and nothing more", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    expect((await w.s.viewer.query("select * from public.prospects")).length).toBe(1);
    expect((await w.s.viewer.query("select * from public.settings_versions")).length).toBeGreaterThan(0);
    expect(await w.s.viewer.error("select public.create_run('{b.com}', 'paste', '', '{}')")).toMatch(/Only an operator/);
    expect(await w.s.viewer.error("insert into public.suppressions (kind, value, reason) values ('domain', 'x.com', 'because')")).toMatch(/row-level security/);
    expect(await w.s.viewer.error("insert into public.decisions (kind, reason, run_id) values ('skip', 'because', gen_random_uuid())")).toMatch(/row-level security/);
    expect(await w.s.viewer.error("select * from public.claim_next_prospect()")).toMatch(/Not allowed/);
    expect(await w.s.viewer.query("select * from public.contacts")).toEqual([]);
    expect(await w.s.viewer.error("update public.prospects set lane = 'failed'")).toMatch(/permission denied/);
  });

  it("lets an operator run things but not change the rules", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    expect(await w.s.operator.error("insert into public.suppressions (kind, value, reason) values ('domain', 'x.com', 'asked us to stop')")).toBeNull();
    expect(await w.s.operator.error("insert into public.settings_versions (reason) values ('sneaky change')")).toMatch(/row-level security/);
    expect(await w.s.operator.error("insert into public.icp_versions (config, reason) values ('{}', 'sneaky change')")).toMatch(/row-level security/);
    expect(await w.s.operator.error("insert into public.icp_signoffs (icp_version_id) select id from public.icp_versions limit 1")).toMatch(/row-level security/);
    expect(await w.s.operator.error("update public.profiles set role = 'admin' where id = $1", [w.u.operator])).toMatch(/permission denied/);
    expect(await w.s.operator.error("select public.set_user_role($1, 'admin')", [w.u.operator])).toMatch(/Only an admin/);
    expect((await w.db.admin<{ role: string }>("select role from public.profiles where id = $1", [w.u.operator]))[0]!.role).toBe("operator");
  });

  it("lets only an admin change settings, the ICP, its sign-off and roles", async () => {
    const w = await world();
    expect(await w.s.admin.error("insert into public.settings_versions (reason) values ('raise the cap')")).toBeNull();
    expect(await w.s.admin.error("insert into public.icp_versions (config, reason) values ('{}', 'draft v2')")).toBeNull();
    await w.s.admin.query("select public.set_user_role($1, 'operator')", [w.u.viewer]);
    expect((await w.db.admin<{ role: string }>("select role from public.profiles where id = $1", [w.u.viewer]))[0]!.role).toBe("operator");
    const [c] = await w.db.admin<{ old_role: string; new_role: string; created_by: string }>("select old_role, new_role, created_by from public.role_changes");
    expect(c).toMatchObject({ old_role: "viewer", new_role: "operator", created_by: w.u.admin });
  });

  it("never lets the last admin be demoted", async () => {
    const w = await world();
    expect(await w.s.admin.error("select public.set_user_role($1, 'viewer')", [w.u.admin])).toMatch(/last admin/);
    await w.s.admin.query("select public.set_user_role($1, 'admin')", [w.u.operator]);
    expect(await w.s.admin.error("select public.set_user_role($1, 'viewer')", [w.u.admin])).toBeNull();
  });

  it("lets a person read their own profile and an admin read all, but nobody edit anything but the role", async () => {
    const w = await world();
    expect((await w.s.viewer.query("select id from public.profiles")).map((r) => (r as { id: string }).id)).toEqual([w.u.viewer]);
    expect((await w.s.admin.query("select id from public.profiles")).length).toBe(6);
    expect(await w.s.admin.error("update public.profiles set email = 'x@y.co' where id = $1", [w.u.viewer])).toMatch(/permission denied/);
    expect(await w.s.admin.error("update public.profiles set role = 'admin' where id = $1", [w.u.viewer])).toMatch(/permission denied/);
  });

  it("creates a pending profile for every new login, so nobody arrives with access", async () => {
    const w = await world();
    const id = await w.db.createUser("stranger@example.com");
    expect((await w.db.admin<{ role: string }>("select role from public.profiles where id = $1", [id]))[0]!.role).toBe("pending");
  });

  it("masks addresses for viewers through the contacts view", async () => {
    const w = await world();
    await w.startRun(["acme.com"]);
    const p = await w.claim();
    await w.s.worker.query("insert into public.contacts (prospect_id, source, first_name, email, chosen) values ($1, 'hunter', 'Priya', 'priya@acme.com', true)", [p!.id]);
    const masked = await w.s.viewer.query<{ email_masked: string; first_initial: string }>("select * from public.contacts_masked");
    expect(masked[0]).toMatchObject({ email_masked: "p***@acme.com", first_initial: "P.", rank_parts: [], excluded: null });
    expect(JSON.stringify(masked)).not.toContain("priya@acme.com");
    expect(await w.s.pending.query("select * from public.contacts_masked")).toEqual([]);
  });
});

describe("stamping: the database writes who and when", () => {
  it("overwrites a back-dated time and a forged author", async () => {
    const w = await world();
    await w.s.operator.query("insert into public.suppressions (kind, value, reason, created_at, created_by) values ('domain', 'x.com', 'asked us to stop', '2001-01-01', $1)", [w.u.admin]);
    const [row] = await w.s.operator.query<{ created_at: string; created_by: string }>("select created_at, created_by from public.suppressions where value = 'x.com'");
    expect(row!.created_by).toBe(w.u.operator);
    expect(new Date(row!.created_at).getFullYear()).toBeGreaterThan(2020);
  });

  it("stamps decisions the same way", async () => {
    const w = await world();
    const run = await w.startRun(["acme.com"]);
    await w.s.operator.query("insert into public.decisions (run_id, kind, reason, created_by) values ($1, 'pause_run', 'checking something', $2)", [run, w.u.admin]);
    expect((await w.s.operator.query<{ created_by: string }>("select created_by from public.decisions"))[0]!.created_by).toBe(w.u.operator);
  });
});

describe("settings validation", () => {
  it.each([
    ["a list of recipients", "test_to", "'a@b.com, c@d.com'"],
    ["a name and angle brackets", "test_to", "'Me <a@b.com>'"],
    ["a daily cap above 200", "daily_send_cap", "500"],
    ["a negative reserve", "hunter_reserve", "-1"],
    ["a zero run size", "max_run_size", "0"],
    ["negative review minutes", "review_minutes_per_email", "-1"],
    ["an absurd decision time", "review_minutes_per_decision", "600"],
  ])("refuses %s", async (_n, col, val) => {
    const w = await world();
    expect(await w.s.admin.error(`insert into public.settings_versions (${col}, reason) values (${val}, 'testing it')`)).toMatch(/violates check constraint/);
  });

  it("requires a reason for every change", async () => {
    const w = await world();
    expect(await w.s.admin.error("insert into public.settings_versions (reason) values ('  ')")).toMatch(/violates check constraint/);
  });
});

describe("changing roles is a recorded act", () => {
  it("records each change, refuses a no-op, and keeps the record append-only and admin-only", async () => {
    const w = await world();
    await w.s.admin.query("select public.set_user_role($1, 'operator')", [w.u.viewer]);
    expect(await w.s.admin.error("select public.set_user_role($1, 'operator')", [w.u.viewer])).toMatch(/already have that role/);
    expect(await w.s.admin.error("select public.set_user_role(gen_random_uuid(), 'viewer')")).toMatch(/Unknown person/);
    expect(await w.s.operator.query("select * from public.role_changes")).toEqual([]);
    expect(await w.s.admin.query("select * from public.role_changes")).toHaveLength(1);
    await expect(w.db.admin("update public.role_changes set new_role = 'viewer'")).rejects.toThrow(/append-only/);
    await expect(w.db.admin("delete from public.role_changes")).rejects.toThrow(/append-only/);
  });
});
