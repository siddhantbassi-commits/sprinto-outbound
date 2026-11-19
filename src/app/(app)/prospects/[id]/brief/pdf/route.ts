import { NextResponse } from "next/server";
import { briefFor } from "@/lib/app/brief";
import { seesContacts } from "@/lib/app/privacy";
import { getSession } from "@/lib/app/runtime";
import { onePagerFilename, renderOnePager } from "@/lib/brief/onepager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The brief as a one-page PDF. It reads the brief as the signed-in person (or guest) is allowed to see it, so it can show nothing the page does not. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || s.user.role === "pending") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!ID.test(id)) return NextResponse.json({ error: "That is not a company." }, { status: 404 });
  const view = await briefFor(s.db, id, seesContacts(s));
  if (!view) return NextResponse.json({ error: "That company was not found." }, { status: 404 });
  const { bytes } = await renderOnePager(view.brief);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${onePagerFilename(view.brief.company.domain)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
