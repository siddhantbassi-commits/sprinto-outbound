/**
 * Runs the golden set from the command line, and prints how it went. It does not touch the database.
 *
 *   npm run golden               on the real model (needs GEMINI_API_KEY), the way the weekly job does
 *   npm run golden -- --scripted on the built-in stand-in model: proves the harness works, measures nothing
 *   npm run golden -- --json     the full result as JSON
 *
 * Exits 0 on a pass, 1 on a warning or failure, so it can gate a change to a prompt or a model.
 */
import { existsSync } from "node:fs";
import { createGeminiClient, modelChain } from "@/lib/ai/gemini";
import { readEnv } from "@/lib/env";
import { goldenOracle, runGolden } from "@/lib/quality/harness";
import { renderGolden } from "@/lib/quality/render";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const scripted = args.includes("--scripted");
const env = readEnv({ ...process.env, DEMO_MODE: undefined });

async function main() {
  if (!scripted && !env.gemini) {
    console.error("GEMINI_API_KEY is not set. Run `npm run keys` first, or use --scripted to check the harness with the stand-in model.");
    process.exit(2);
  }
  const ai = scripted ? goldenOracle() : createGeminiClient({ apiKey: env.gemini!.apiKey, models: modelChain({ GEMINI_MODEL: env.gemini!.model }) });
  const run = await runGolden({ ai });
  if (args.includes("--json")) console.log(JSON.stringify(run, null, 2));
  else console.log(renderGolden(run, scripted ? "scripted" : "live"));
  process.exit(run.summary.status === "pass" ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "The golden set could not run.");
  process.exit(2);
});
