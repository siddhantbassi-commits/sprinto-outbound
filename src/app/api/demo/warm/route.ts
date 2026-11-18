import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { getDemo } from "@/lib/demo/world";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Starts the sample workspace so the first real page is quick: the welcome animation calls this while it plays. Only the demo
 * has anything to start; anywhere else this does not exist.
 */
export async function GET() {
  if (readEnv().mode !== "demo") return new NextResponse("Not found", { status: 404 });
  await getDemo();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
