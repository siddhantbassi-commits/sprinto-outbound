import "server-only";
import { cookies } from "next/headers";
import { readToken, REVIEWER_COOKIE } from "@/lib/app/reviewer";
import { reviewerSetup } from "@/lib/app/runtime";

/**
 * The address this browser has proved is its own, or null. The cookie is signed on the server, so it cannot be made up; the database
 * checks again at approval that the address was confirmed in the last day, so a stale cookie cannot send anything either.
 */
export async function confirmedReviewer(): Promise<string | null> {
  const setup = reviewerSetup();
  if (!setup) return null;
  return readToken(setup.key, (await cookies()).get(REVIEWER_COOKIE)?.value, Date.now());
}
