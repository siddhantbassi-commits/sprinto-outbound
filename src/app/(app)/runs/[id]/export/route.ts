import { NextResponse, type NextRequest } from "next/server";
import { csvRow } from "@/lib/app/list";
import { getRun } from "@/lib/app/queries";
import { getSession } from "@/lib/app/runtime";

export const dynamic = "force-dynamic";

/**
 * The run as a spreadsheet. Every cell is neutralised against formula injection (a company's own name or a scraped reason
 * can begin with "=" and would otherwise run in Excel), and contact addresses are masked unless the person may see them.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || s.user.role === "pending") return new NextResponse("Not allowed", { status: 403 });
  const data = await getRun(s.db, id);
  if (!data) return new NextResponse("Not found", { status: 404 });
  const full = s.user.role !== "viewer";

  const lines = [csvRow(["domain", "lane", "step", "verdict", "score", "reason", "contact", "contact_title", "contact_email"])];
  for (const p of data.prospects) {
    const rows = await s.db.select(full ? "contacts" : "contacts_masked", { prospect_id: p.id });
    const chosen = rows.find((c) => c.chosen);
    const name = chosen ? (full ? [chosen.first_name, chosen.last_name].filter(Boolean).join(" ") : String(chosen.first_initial ?? "")) : "";
    const email = chosen ? String((full ? chosen.email : chosen.email_masked) ?? "") : "";
    lines.push(csvRow([p.domain, p.lane, p.step, p.verdict, p.score, p.lane_reason, name, chosen?.position ?? "", email]));
  }
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="run-${id.slice(0, 8)}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
