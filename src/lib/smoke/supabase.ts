import { supabasePort, type SupabaseLike } from "@/lib/db/supabase";
import { factsFileProblems, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import { withSettings } from "@/lib/worker/pipeline";
import { fail, pass, safely, skip, warn, type Check } from "./report";

const S = "supabase";

/** The part of the Supabase client the checks need: the data calls, plus signing in with a password. */
export interface SbClient extends SupabaseLike {
  auth: { signInWithPassword(c: { email: string; password: string }): PromiseLike<{ error: { message: string } | null }> };
}

export interface SupabaseSmokeOptions {
  /** Makes a fresh client for the project (anonymous until it signs in). */
  make: () => SbClient;
  worker: { email: string; password: string };
  testTo: string | null;
  /** True if a service-role key is present in the environment, which this project never wants. */
  serviceKeyPresent: boolean;
  /** Asks the project whether it accepts this key at all, with no sign-in. A refusal later only means something if this passes. */
  keyAccepted: () => Promise<boolean>;
}

export async function supabaseChecks(o: SupabaseSmokeOptions): Promise<Check[]> {
  const out: Check[] = [];

  out.push(
    ...(await safely(S, "service-key", "No service-role key is in the environment", async () =>
      o.serviceKeyPresent
        ? fail(S, "service-key", "No service-role key is in the environment", "SUPABASE_SERVICE_ROLE_KEY is set", "Remove it. The worker signs in as its own account; this project never uses the service role.")
        : pass(S, "service-key", "No service-role key is in the environment", "none set, as intended"),
    )),
  );

  // Every later check assumes the project recognises the key. Without this, a wrong key makes "an anonymous visitor cannot
  // read the data" pass for the wrong reason: the project refused the key, not the data.
  let accepted = false;
  out.push(
    ...(await safely(S, "key", "The project accepts the key", async () => {
      accepted = await o.keyAccepted();
      return accepted
        ? pass(S, "key", "The project accepts the key", "the project recognised it")
        : fail(S, "key", "The project accepts the key", "the project answered \"Invalid API key\"", "NEXT_PUBLIC_SUPABASE_ANON_KEY is wrong (a URL, a truncated paste or another project's key). Run `npm run keys` and paste the anon key from Project Settings > API Keys once. Nothing below can be trusted until this passes.");
    })),
  );
  if (!accepted) return out;

  // The anonymous visitor must see nothing.
  out.push(
    ...(await safely(S, "anon", "An anonymous visitor cannot read the data", async () => {
      const anon = o.make();
      const tables = ["prospects", "emails", "contacts", "settings_versions"];
      const leaks: string[] = [];
      for (const t of tables) {
        const { data, error } = (await anon.from(t).select("*").limit(1)) as { data: unknown[] | null; error: { message: string } | null };
        if (!error && data && data.length > 0) leaks.push(t);
      }
      return leaks.length ? fail(S, "anon", "An anonymous visitor cannot read the data", `rows came back without signing in from: ${leaks.join(", ")}`, "Row-level security is not doing its job. Re-apply supabase/migrations/…000500_security.sql.") : pass(S, "anon", "An anonymous visitor cannot read the data", `${tables.length} tables checked: nothing readable, or permission refused`);
    })),
  );

  // The worker's own login.
  const client = o.make();
  let signedIn = false;
  out.push(
    ...(await safely(S, "login", "The worker account can sign in", async () => {
      const { error } = await client.auth.signInWithPassword(o.worker);
      if (error) return fail(S, "login", "The worker account can sign in", "sign-in was refused", "Check WORKER_EMAIL and WORKER_PASSWORD, and that the user was invited and confirmed in Supabase.");
      signedIn = true;
      return pass(S, "login", "The worker account can sign in", "signed in");
    })),
  );
  if (!signedIn) return out;
  const db = supabasePort(client);

  out.push(
    ...(await safely(S, "role", "The worker has the worker role, and sees only itself in profiles", async () => {
      const rows = await db.select("profiles");
      const mine = rows[0];
      if (rows.length !== 1 || mine?.role !== "worker") return fail(S, "role", "The worker has the worker role, and sees only itself in profiles", `it sees ${rows.length} profile(s) with role ${String(mine?.role ?? "none")}`, "Run: update public.profiles set role = 'worker' where email = '…';");
      return pass(S, "role", "The worker has the worker role, and sees only itself in profiles", "role is worker");
    })),
  );

  let settings: Record<string, unknown> | undefined;
  out.push(
    ...(await safely(S, "migrations", "The migrations are applied", async () => {
      try {
        [settings] = await db.rpc("settings_now");
      } catch (e) {
        return fail(S, "migrations", "The migrations are applied", `settings_now() failed: ${e instanceof Error ? e.message : "unknown"}`, "Apply supabase/migrations in order (see supabase/README.md).");
      }
      if (!settings?.id) return fail(S, "migrations", "The migrations are applied", "there is no settings row", "Apply 000200_versions.sql.");
      return pass(S, "migrations", "The migrations are applied", `settings version ${String(settings.version)} is in place`);
    })),
  );
  if (!settings?.id) return out;

  out.push(
    ...(await safely(S, "test-address", "The recorded test address matches the server's", async () => {
      const recorded = String(settings?.test_to ?? "");
      if (!recorded) return fail(S, "test-address", "The recorded test address matches the server's", "settings have no test address, so every send is refused", "An admin sets it in Settings.");
      if (!o.testTo) return warn(S, "test-address", "The recorded test address matches the server's", `recorded as ${recorded}, but OUTBOUND_TEST_TO is not set here`);
      return recorded.toLowerCase() === o.testTo.toLowerCase() ? pass(S, "test-address", "The recorded test address matches the server's", `both are ${recorded}`) : fail(S, "test-address", "The recorded test address matches the server's", `settings say ${recorded} but OUTBOUND_TEST_TO says ${o.testTo}; nothing will send`, "Make them the same.");
    })),
  );

  out.push(
    ...(await safely(S, "icp", "An ICP version has been signed off", async () => {
      const so = await db.select("icp_signoffs", {}, { limit: 1 });
      return so.length ? pass(S, "icp", "An ICP version has been signed off", "yes") : fail(S, "icp", "An ICP version has been signed off", "none, so no run can start", "An admin signs one off in Settings.");
    })),
  );

  out.push(
    ...(await safely(S, "facts", "The Sprinto facts file is ready for drafting", async () => {
      const [row] = await db.select("sprinto_facts_versions", {}, { order: "version", ascending: false, limit: 1 });
      if (!row) return fail(S, "facts", "The Sprinto facts file is ready for drafting", "there is no facts file");
      const problems = factsFileProblems(withSettings(row.content as SprintoFactsFile, { sender_name: String(settings?.sender_name ?? ""), sender_title: String(settings?.sender_title ?? ""), postal_address: String(settings?.postal_address ?? "") }));
      return problems.length ? fail(S, "facts", "The Sprinto facts file is ready for drafting", problems.join(" "), "Fix these in Settings. Nothing can be drafted until they are.") : pass(S, "facts", "The Sprinto facts file is ready for drafting", "a claim is verified by a person, and the sender and address are set");
    })),
  );
  return out;
}

export const supabaseSkipped = (why: string): Check[] => [skip(S, "all", "Supabase", why, "Run `npm run keys` to enter these through a hidden prompt.")];
