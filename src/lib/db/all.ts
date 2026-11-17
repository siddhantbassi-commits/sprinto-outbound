import type { DbPort, Row, SelectOptions } from "./port";

/** Supabase answers at most 1,000 rows (or whatever its max-rows is) per request, silently. This reads them all, page by page. */
const PAGE = 1000;

/**
 * Reads every matching row, up to `max`, by paging until a page comes back empty. It does not trust a short page to mean
 * "the end", because the server's own row cap may be smaller than the page asked for. `order` is required: without a
 * stable order, paging can skip or repeat rows.
 */
export async function selectAll(db: DbPort, table: string, where: Row, opts: Omit<SelectOptions, "limit" | "offset"> & { order: string }, max = 20_000): Promise<Row[]> {
  const out: Row[] = [];
  while (out.length < max) {
    const page = await db.select(table, where, { ...opts, limit: Math.min(PAGE, max - out.length), offset: out.length });
    if (page.length === 0) break;
    out.push(...page);
  }
  return out;
}
