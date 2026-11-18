import { activeSuppressions } from "@/lib/app/queries";
import { selectAll } from "@/lib/db/all";
import type { DbPort } from "@/lib/db/port";
import type { Known } from "@/lib/discovery/discover";

/**
 * What the system already knows about a company, from the signed-in person's own view of the database: researched before,
 * on the do-not-contact list, or mailed inside the cooldown. Discovery uses it to say so beside a suggestion instead of
 * offering the same company again as if it were new.
 */
export async function loadKnown(db: DbPort, cooldownDays: number): Promise<Known> {
  const [suppressions, prospects, emails] = await Promise.all([
    activeSuppressions(db),
    selectAll(db, "prospects", {}, { order: "created_at", ascending: false, columns: "domain" }, 5000),
    db.select("emails", {}, { order: "created_at", ascending: false, limit: 1000 }),
  ]);
  const cutoff = Date.now() - cooldownDays * 86_400_000;
  return {
    blocklist: [],
    researched: new Set(prospects.map((p) => String(p.domain))),
    suppressed: new Set(suppressions.filter((x) => x.kind === "domain").map((x) => x.value)),
    mailed: new Set(emails.filter((e) => ["sending", "sent", "unknown"].includes(String(e.status)) && e.sending_at && new Date(e.sending_at as string).getTime() > cutoff).map((e) => String(e.domain))),
  };
}
