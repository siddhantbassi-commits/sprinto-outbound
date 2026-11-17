import { NextResponse, type NextRequest } from "next/server";
import { env, workerDeps } from "@/lib/app/runtime";
import { sameSecret } from "@/lib/env";
import { tick } from "@/lib/worker/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let running = false;

/**
 * The scheduled worker calls this (GitHub Actions, every 15 minutes) with a shared secret. It runs as the worker's own
 * account. Without the right secret nothing happens, and the response never says which part was wrong.
 */
export async function POST(request: NextRequest) {
  const e = env();
  const sent = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!e.cronSecret || !sameSecret(sent, e.cronSecret)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (running) return NextResponse.json({ busy: true });
  running = true;
  try {
    const result = await tick(await workerDeps(), { source: "cron", maxSteps: 12, budgetMs: 25_000 });
    return NextResponse.json({ ...result, more: result.processed > 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The worker could not run." }, { status: 500 });
  } finally {
    running = false;
  }
}
