import { chooseContact } from "@/lib/contacts/rank";
import { createHunterClient, HunterError } from "@/lib/contacts/hunter";
import { fail, pass, safely, skip, warn, type Check } from "./report";

const S = "hunter";

const mask = (email: string | null) => (email ? `${email[0]}***@${email.split("@")[1] ?? ""}` : "no address");

export interface HunterSmokeOptions {
  apiKey: string;
  reserve: number;
  /** When set, makes one real search, which can spend a credit. */
  searchDomain?: string;
  fetchFn?: typeof fetch;
}

export async function hunterChecks(o: HunterSmokeOptions): Promise<Check[]> {
  const client = createHunterClient({ apiKey: o.apiKey, fetchFn: o.fetchFn });
  const out: Check[] = [];

  out.push(
    ...(await safely(S, "account", "The key works and the credit balance can be read", async () => {
      const a = await client.account();
      const left = a.remaining - o.reserve;
      const detail = `${a.remaining} ${a.unit} left of ${a.available}${a.resetDate ? `, resetting ${a.resetDate}` : ""}; ${o.reserve} are kept in reserve`;
      if (left <= 0) return warn(S, "account", "The key works and the credit balance can be read", `${detail}, so no domain can be looked up`, "Wait for credits to renew, or use hand-picked contacts.");
      return pass(S, "account", "The key works and the credit balance can be read", `${detail}, so up to ${Math.floor(left)} domains can be looked up`);
    })),
  );

  if (!o.searchDomain) {
    out.push(skip(S, "search", "A real search returns people we can use", "not run: a search can spend one credit", "Add `--hunter-search yourtarget.com` to check the real response and the seniority words."));
    return out;
  }

  out.push(
    ...(await safely(S, "search", `A real search for ${o.searchDomain}`, async () => {
      try {
        const r = await client.domainSearch(o.searchDomain as string);
        if (r.candidates.length === 0) return warn(S, "search", `A real search for ${o.searchDomain}`, `Hunter accepted the request (type=personal, seniority=senior,executive) and found nobody; ${r.creditsUsed} credits used`, "Try a larger company. The request words are fine.");
        const choice = chooseContact(r.candidates, null);
        const who = choice.chosen ? `${choice.chosen.candidate.position ?? "(no title)"} (${mask(choice.chosen.candidate.email)}), rank ${choice.chosen.score}` : "nobody suitable";
        return pass(S, "search", `A real search for ${o.searchDomain}`, `${r.candidates.length} candidates of ${r.total} on file; ${r.creditsUsed} credits used; ranked first: ${who}`);
      } catch (e) {
        if (e instanceof HunterError && e.code === "bad_request") return fail(S, "search", `A real search for ${o.searchDomain}`, "Hunter rejected the request as invalid", "The scope warned that `seniority` and `type` take values from a live list. Check Hunter's current documentation and edit src/lib/contacts/hunter.ts.");
        throw e;
      }
    })),
  );
  return out;
}
