import { NextResponse } from "next/server";
import { getSession } from "@/lib/app/runtime";
import { runStatuses } from "@/lib/app/status";

export const dynamic = "force-dynamic";

/** The newest runs and how far along each is, for the progress card and the finish notice. Read-only, and only what the signed-in person can already see. */
export async function GET() {
  const s = await getSession();
  if (!s || s.user.role === "pending") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const runs = await runStatuses(s.db);
  return NextResponse.json({ runs, canAdvance: s.user.role === "operator" || s.user.role === "admin" }, { headers: { "Cache-Control": "no-store" } });
}
