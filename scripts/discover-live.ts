/**
 * One real Discover search against Hunter (free: no credit is spent) with the real home-page check, printed as a table.
 * For looking at what the live feature returns before trusting it. Reads HUNTER_API_KEY from the environment; never prints it.
 */
import { createHunterClient } from "@/lib/contacts/hunter";
import { defaultCriteria } from "@/lib/discovery/criteria";
import { discover } from "@/lib/discovery/discover";
import { ICP_V1 } from "@/lib/icp/config";
import { nodeTransport, systemResolver } from "@/lib/scrape/fetch";
import { botUserAgent } from "@/lib/scrape/site";

async function main() {
  const key = (process.env.HUNTER_API_KEY ?? "").trim();
  if (!key) throw new Error("HUNTER_API_KEY is not set.");
  const hunter = createHunterClient({ apiKey: key });
  const started = Date.now();
  const out = await discover(
    { ...defaultCriteria(ICP_V1), want: 10 },
    { hunter, fetchDeps: { resolve: systemResolver, transport: nodeTransport, userAgent: botUserAgent(process.env.CONTACT_EMAIL ?? "ops@example.com") }, known: { blocklist: [], researched: new Set(), suppressed: new Set(), mailed: new Set() } },
  );
  console.log(`took ${Math.round((Date.now() - started) / 1000)}s; Hunter matches ${out.considered}; by angle ${JSON.stringify(out.byAngle)}; hidden ${JSON.stringify(out.hidden)}; problems ${JSON.stringify(out.problems)}`);
  for (const f of out.found.slice(0, 20)) console.log(`${f.standing === "new" ? " " : "-"} ${f.name} | ${f.domain} | ${f.angles.join("+")} | rank ${f.rank} | ${f.verified ? "checked" : "unchecked"} | ${f.about.slice(0, 100)}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
