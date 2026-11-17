import { NextResponse } from "next/server";
import { getSession, workerDeps } from "@/lib/app/runtime";
import { tick } from "@/lib/worker/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One worker pass at a time per server instance. The database lease keeps two instances from taking the same prospect.
let running = false;

/** A signed-in operator asks the worker to run now. The work is done by the worker's own account, never by the caller's. */
export async function POST() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (s.user.role !== "operator" && s.user.role !== "admin") return NextResponse.json({ error: "Only an operator or admin can run the worker." }, { status: 403 });
  if (running) return NextResponse.json({ busy: true });
  running = true;
  try {
    const result = await tick(await workerDeps(), { source: "browser", maxSteps: 3, budgetMs: 20_000 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The worker could not run." }, { status: 500 });
  } finally {
    running = false;
  }
}
