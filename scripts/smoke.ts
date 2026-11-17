/**
 * Key-day smoke test. Run it before the demo, after your keys are in:
 *
 *   npm run smoke                         every check that does not spend anything
 *   npm run smoke -- --send               also sends ONE test email to your own test address
 *   npm run smoke -- --hunter-search acme.com        also makes one real Hunter search (can spend a credit)
 *   npm run smoke -- --pipeline acme.com  a dry run on one real company: real site, real model, nothing sent
 *   npm run smoke -- --only gemini,gmail  just those sections
 *
 * It reads .env.local (or the environment), prints names and results only, and never prints a key.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createGeminiClient, modelChain } from "@/lib/ai/gemini";
import { createHunterClient } from "@/lib/contacts/hunter";
import { readEnv } from "@/lib/env";
import { nodeTransport, systemResolver } from "@/lib/scrape/fetch";
import { botUserAgent } from "@/lib/scrape/site";
import { geminiChecks, geminiSkipped } from "@/lib/smoke/gemini";
import { gmailChecks } from "@/lib/smoke/gmail";
import { hunterChecks } from "@/lib/smoke/hunter";
import { envChecks, SECRET_NAMES } from "@/lib/smoke/envfile";
import { networkChecks } from "@/lib/smoke/network";
import { dryRun } from "@/lib/smoke/pipeline";
import { render, skip, summarise, type Check } from "@/lib/smoke/report";
import { supabaseChecks, supabaseSkipped, type SbClient } from "@/lib/smoke/supabase";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const value = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = value("only")?.split(",").map((s) => s.trim());
const want = (section: string) => !only || only.includes(section);

const env = readEnv({ ...process.env, DEMO_MODE: undefined });
const raw = process.env;
const secrets = SECRET_NAMES.map((n) => raw[n]);
const fetchDeps = { resolve: systemResolver, transport: nodeTransport, userAgent: botUserAgent(env.contactEmail) };

const checks: Check[] = [];
let email: string | null = null;

async function main() {
  console.log("Sprinto Outbound smoke test (nothing below prints a key)\n");
  checks.push(...envChecks(raw));

  if (want("network")) checks.push(...(await networkChecks(fetchDeps)));

  if (want("gemini")) {
    checks.push(...(env.gemini ? await geminiChecks({ apiKey: env.gemini.apiKey, pinned: env.gemini.model }) : geminiSkipped("GEMINI_API_KEY is not set")));
  }

  if (want("hunter")) {
    checks.push(...(env.hunterKey ? await hunterChecks({ apiKey: env.hunterKey, reserve: 3, searchDomain: value("hunter-search") }) : [skip("hunter", "all", "Hunter", "HUNTER_API_KEY is not set", "Optional: without it only hand-picked contacts work.")]));
  }

  if (want("gmail")) {
    const g = env.gmail;
    checks.push(...(g && env.testTo ? await gmailChecks({ clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken, from: g.from, testTo: env.testTo, send: flag("send") }) : [skip("gmail", "all", "Gmail", "the Gmail keys or OUTBOUND_TEST_TO are not all set", "Run `npm run keys`.")]));
  }

  if (want("supabase")) {
    if (env.supabase && env.worker) {
      const { url, anonKey } = env.supabase;
      checks.push(...(await supabaseChecks({ make: () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as SbClient, worker: env.worker, testTo: env.testTo, serviceKeyPresent: !!raw.SUPABASE_SERVICE_ROLE_KEY, keyAccepted: async () => (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(15_000) })).ok })));
    } else checks.push(...supabaseSkipped("the Supabase URL, anon key and worker login are not all set"));
  }

  const domain = value("pipeline");
  if (domain && want("pipeline")) {
    if (!env.gemini) checks.push(skip("pipeline", "all", "Dry run", "GEMINI_API_KEY is not set"));
    else {
      console.log(`Dry run on ${domain}: reading the real site and asking the real model. This can take a minute…`);
      const ai = createGeminiClient({ apiKey: env.gemini.apiKey, models: modelChain({ GEMINI_MODEL: env.gemini.model }) });
      const r = await dryRun({ domain, ai, fetchDeps, hunter: flag("real-hunter") && env.hunterKey ? createHunterClient({ apiKey: env.hunterKey }) : null });
      checks.push(...r.checks);
      email = r.email;
    }
  }
}

main()
  .catch((e) => checks.push({ section: "script", id: "crash", title: "The script", status: "fail", detail: e instanceof Error ? e.message : "stopped unexpectedly" }))
  .finally(() => {
    if (flag("json")) console.log(JSON.stringify({ summary: summarise(checks), checks }, null, 2).replace(/\x1b\[[0-9;]*m/g, ""));
    else {
      console.log(render(checks, { color: process.stdout.isTTY, secrets }));
      if (email) console.log(`\nThe email it would have sent (shown here only, never mailed):\n${"-".repeat(60)}\n${email}\n${"-".repeat(60)}`);
    }
    process.exit(summarise(checks).ok ? 0 : 1);
  });
