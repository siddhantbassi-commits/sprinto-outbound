import { selectAll } from "@/lib/db/all";
import { createFlight, createSerial, guestMay, guestMayPay, sumUsage, type GuestUsage, type GuestVerdict } from "./guest";
import { hunterBalance, type AppSession } from "./runtime";

/** Today's usage, read from the database so the limits hold across servers, plus Hunter's live balance. */
export async function guestUsage(s: AppSession): Promise<GuestUsage> {
  const [ledger, runs, balance] = await Promise.all([
    selectAll(s.db, "usage_ledger", {}, { order: "created_at", ascending: false, columns: "kind,units,created_at" }, 3000),
    selectAll(s.db, "runs", {}, { order: "created_at", ascending: false, columns: "domain_count,created_by,created_at" }, 500),
    hunterBalance(),
  ]);
  const hunterRemaining = balance && typeof balance.remaining === "number" ? balance.remaining : null;
  return { ...sumUsage(ledger, runs, s.user.id, Date.now()), hunterRemaining };
}

/** Whether this guest may start a run of `requested` companies. A signed-in person is never limited by this. */
export async function guestStartVerdict(s: AppSession, requested: number): Promise<GuestVerdict> {
  if (!s.guest || !s.env.guest) return { ok: true };
  return guestMay(requested, await guestUsage(s), s.env.guest);
}

/** Whether this guest may spend one Hunter credit on a paid check. */
export async function guestPayVerdict(s: AppSession): Promise<GuestVerdict> {
  if (!s.guest || !s.env.guest) return { ok: true };
  return guestMayPay(await guestUsage(s), s.env.guest);
}

/** One guest cap check-and-spend at a time in this server, so two requests at once cannot both pass the same check. */
export const guestSerial = createSerial();
/** One long guest action at a time in this server. */
export const guestFlight = createFlight();
