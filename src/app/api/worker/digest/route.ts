import { NextResponse, type NextRequest } from "next/server";
import { digestSetup, env, workerDb } from "@/lib/app/runtime";
import { sameSecret } from "@/lib/env";
import { runDigest } from "@/lib/digest/run";

export const dynamic = "force-dynamic";
// Three searches and up to two dozen home pages: well under a minute, with room to spare.
export const maxDuration = 120;

let running = false;

/**
 * The weekly job calls this (GitHub Actions) with the shared secret. It runs the saved search as the worker's own account,
 * emails the owner what is new, and records what happened. A digest that ran in the last six days is not repeated, so a late
 * or doubled call does no harm. Without the right secret nothing happens, and the response never says which part was wrong.
 */
export async function POST(request: NextRequest) {
  const e = env();
  const sent = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!e.cronSecret || !sameSecret(sent, e.cronSecret)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (running) return NextResponse.json({ busy: true });
  const setup = await digestSetup();
  if (!setup.ok) return NextResponse.json({ skipped: setup.reason });
  running = true;
  try {
    const r = await runDigest({ db: await workerDb(), hunter: setup.hunter, fetchDeps: setup.fetchDeps, gmail: setup.gmail, appUrl: setup.appUrl, trigger: "cron" });
    if (r.status === "skipped") return NextResponse.json({ skipped: r.reason });
    const d = r.digest;
    return NextResponse.json({ ran: true, considered: d.considered, new: d.found.length, email: d.email_status, problems: d.problems });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The digest could not run." }, { status: 500 });
  } finally {
    running = false;
  }
}
