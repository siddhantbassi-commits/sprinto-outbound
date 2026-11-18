import { NextResponse } from "next/server";
import { getSession } from "@/lib/app/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Wakes the guest pass while the welcome plays: signs the guest account in and reads one row, so the first page is quick. */
export async function GET() {
  const s = await getSession();
  if (!s?.guest) return NextResponse.json({ error: "Not available." }, { status: 404 });
  await s.db.select("icp_versions", {}, { limit: 1 });
  return NextResponse.json({ ok: true });
}
