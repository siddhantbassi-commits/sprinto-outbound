import { NextResponse, type NextRequest } from "next/server";
import { leadsToCsv, type ExportFormat } from "@/lib/app/lead-export";
import { applyLeadQuery, parseLeadQuery } from "@/lib/app/lead-query";
import { listLeads } from "@/lib/app/leads";
import { getSession } from "@/lib/app/runtime";

export const dynamic = "force-dynamic";

/** The leads currently on screen (same search, filters and view) as a spreadsheet. A viewer's file holds masked addresses only. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || s.user.role === "pending") return new NextResponse("Not allowed", { status: 403 });
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const format: ExportFormat = params.format === "hubspot" ? "hubspot" : "csv";
  const q = parseLeadQuery(params);
  // An export is of rows, not of a board, so the board's own view falls back to the leads in a stage.
  const leads = applyLeadQuery(await listLeads(s.db, s.user.role !== "viewer"), q, Date.now());
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(leadsToCsv(leads, format), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${format}-${stamp}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
