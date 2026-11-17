import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AiError } from "@/lib/ai/errors";
import { createGeminiClient, modelChain } from "@/lib/ai/gemini";
import type { AiClient } from "@/lib/ai/types";
import { demoAskAi } from "@/lib/ask/demo";
import { goldenOracle } from "@/lib/quality/harness";
import { createHunterClient } from "@/lib/contacts/hunter";
import type { DbPort } from "@/lib/db/port";
import { pgPort } from "@/lib/db/pg-port";
import { supabasePort, type SupabaseLike } from "@/lib/db/supabase";
import { demoHunter, getDemo } from "@/lib/demo/world";
import { createGmailSender } from "@/lib/email/gmail";
import { readEnv, type AppEnv } from "@/lib/env";
import { nodeTransport, systemResolver } from "@/lib/scrape/fetch";
import { botUserAgent } from "@/lib/scrape/site";
import type { PipelineDeps } from "@/lib/worker/pipeline";
import { Store } from "@/lib/worker/store";

/**
 * Everything the app and the scheduled worker need from the outside world, built from the environment. This is the one
 * place where "who is asking" is decided: a signed-in person (their own database session, so row-level security applies)
 * or the worker's own account (a separate login, never a service-role key).
 */

export type Role = "pending" | "viewer" | "operator" | "admin" | "worker";

export interface AppSession {
  mode: AppEnv["mode"];
  user: { id: string; email: string; role: Role };
  db: DbPort;
  env: AppEnv;
}

export const env = (): AppEnv => readEnv();

const asLike = (c: unknown) => c as SupabaseLike;

/** The signed-in person for this request, or null. In demo mode, a person is chosen from a cookie, because there is no sign-in. */
export async function getSession(): Promise<AppSession | null> {
  const e = env();
  const store = await cookies();

  if (e.mode === "demo") {
    const demo = await getDemo();
    const wanted = store.get("demo_role")?.value;
    const role = (["admin", "operator", "viewer", "pending"] as const).find((r) => r === wanted) ?? "admin";
    const id = demo.users[role];
    return { mode: "demo", user: { id, email: `${role}@demo.example`, role }, db: pgPort(demo.db.as(id)), env: e };
  }

  if (!e.supabase) return null;
  const supabase = createServerClient(e.supabase.url, e.supabase.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // A Server Component cannot set cookies; the proxy refreshes the session instead, so this is safe to skip there.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* read-only context */
        }
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const db = supabasePort(asLike(supabase));
  const [profile] = await db.select("profiles", { id: data.user.id });
  return { mode: "supabase", user: { id: data.user.id, email: data.user.email ?? "", role: ((profile?.role as Role | undefined) ?? "pending") }, db, env: e };
}

// ---------------------------------------------------------------- the worker
let cachedWorker: { port: DbPort; expires: number } | null = null;

async function workerPort(e: AppEnv): Promise<DbPort> {
  if (e.mode === "demo") {
    const demo = await getDemo();
    return pgPort(demo.db.as(demo.users.worker));
  }
  if (cachedWorker && cachedWorker.expires > Date.now()) return cachedWorker.port;
  if (!e.supabase || !e.worker) throw new Error("The worker account is not configured.");
  const client = createClient(e.supabase.url, e.supabase.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: e.worker.email, password: e.worker.password });
  if (error) throw new Error("The worker could not sign in. Check WORKER_EMAIL and WORKER_PASSWORD.");
  cachedWorker = { port: supabasePort(asLike(client)), expires: Date.now() + 30 * 60_000 };
  return cachedWorker.port;
}

const unconfiguredAi: AiClient = {
  async generateJson() {
    throw new AiError("not_configured");
  },
  async generateTurn() {
    throw new AiError("not_configured");
  },
};

/** The worker's tools, wired from the environment. A missing key means that step explains itself; it never guesses. */
export async function workerDeps(): Promise<PipelineDeps> {
  const e = env();
  const store = new Store(await workerPort(e));
  if (e.mode === "demo") {
    const demo = await getDemo();
    return demo.deps(store);
  }
  return {
    store,
    ai: e.gemini ? createGeminiClient({ apiKey: e.gemini.apiKey, models: modelChain({ GEMINI_MODEL: e.gemini.model }) }) : unconfiguredAi,
    fetchDeps: { resolve: systemResolver, transport: nodeTransport, userAgent: botUserAgent(e.contactEmail) },
    hunter: e.hunterKey ? createHunterClient({ apiKey: e.hunterKey }) : null,
    gmail: e.gmail && e.testTo ? createGmailSender({ ...e.gmail, testTo: e.testTo }) : null,
    appUrl: e.appUrl,
    now: Date.now,
    stepBudgetMs: 35_000,
  };
}

/** Hunter's live credit balance for the New run page. Null means Hunter is not configured; an error is shown, not hidden. */
export async function hunterBalance(): Promise<{ remaining: number; error?: undefined } | { error: string; remaining?: undefined } | null> {
  const e = env();
  try {
    if (e.mode === "demo") return { remaining: (await demoHunter().account()).remaining };
    if (!e.hunterKey) return null;
    return { remaining: (await createHunterClient({ apiKey: e.hunterKey }).account()).remaining };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Hunter could not be reached." };
  }
}

/** The worker's own database session, for the scheduled jobs that record their results. */
export async function workerDb(): Promise<DbPort> {
  return workerPort(env());
}

/**
 * What reads the golden set. With a Gemini key it is the real model, so the result is a measurement. In demo mode there
 * is no key, so it is the built-in stand-in that answers from the known truth: that proves the plumbing, and the result
 * is marked as scripted everywhere it is shown.
 */
export function goldenSetup(): { ok: true; ai: AiClient; source: "live" | "scripted" } | { ok: false; reason: string } {
  const e = env();
  if (e.mode === "demo") return { ok: true, ai: goldenOracle(), source: "scripted" };
  if (!e.gemini) return { ok: false, reason: "The Gemini key is not set, so there is no model to test." };
  return { ok: true, ai: createGeminiClient({ apiKey: e.gemini.apiKey, models: modelChain({ GEMINI_MODEL: e.gemini.model }) }), source: "live" };
}

/** What answers Ask: the real model with a key, or in demo mode a keyword stand-in that uses the same tools and checks. */
export function askSetup(): { ok: true; ai: AiClient; standIn: boolean } | { ok: false; reason: string } {
  const e = env();
  if (e.mode === "demo") return { ok: true, ai: demoAskAi(), standIn: true };
  if (!e.gemini) return { ok: false, reason: "The Gemini key is not set, so Ask cannot answer." };
  return { ok: true, ai: createGeminiClient({ apiKey: e.gemini.apiKey, models: modelChain({ GEMINI_MODEL: e.gemini.model }) }), standIn: false };
}
