import { NextResponse, type NextRequest } from "next/server";
import { env, goldenSetup, workerDb } from "@/lib/app/runtime";
import { sameSecret } from "@/lib/env";
import { runAndRecord } from "@/lib/quality/record";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

/**
 * The weekly job calls this (GitHub Actions) with the shared secret. It runs the golden set on the real model as the
 * worker's own account, keeps the result, and says what happened. Without the right secret nothing happens, and the
 * response never says which part was wrong.
 */
export async function POST(request: NextRequest) {
  const e = env();
  const sent = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!e.cronSecret || !sameSecret(sent, e.cronSecret)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (running) return NextResponse.json({ busy: true });
  const setup = goldenSetup();
  if (!setup.ok) return NextResponse.json({ error: setup.reason }, { status: 503 });
  running = true;
  try {
    const r = await runAndRecord({ db: await workerDb(), ai: setup.ai, source: setup.source, trigger: "weekly" });
    if (!r.ok) return NextResponse.json({ skipped: r.reason });
    const s = r.run.summary;
    return NextResponse.json({ status: s.status, source: setup.source, accuracy: s.accuracy, wrongRate: s.wrongRate, verdictAgreement: s.verdictAgreement, spurious: s.spurious, errors: s.errors, reasons: s.reasons });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The golden set could not run." }, { status: 500 });
  } finally {
    running = false;
  }
}
