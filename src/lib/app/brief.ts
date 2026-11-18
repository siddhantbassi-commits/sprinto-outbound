import { getProspect } from "@/lib/app/queries";
import type { DbPort } from "@/lib/db/port";
import { buildBrief, type Brief, type BriefInput } from "@/lib/brief/build";
import { verifiedClaims, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export interface BriefView {
  prospectId: string;
  runId: string;
  lane: string;
  brief: Brief;
}

/** The latest facts file as the draft step reads it. A viewer may read it too (it holds no personal data). */
async function claimsFile(db: DbPort): Promise<{ claims: string[]; unverified: number }> {
  const [row] = await db.select("sprinto_facts_versions", {}, { order: "version", ascending: false, limit: 1 });
  const file = row?.content as SprintoFactsFile | undefined;
  if (!file || !Array.isArray(file.items)) return { claims: [], unverified: 0 };
  const ok = verifiedClaims(file);
  return { claims: ok.map((i) => i.claim), unverified: file.items.length - ok.length };
}

/** Builds the brief for one prospect from what the signed-in person is allowed to see. */
export async function briefFor(db: DbPort, id: string, canSeeContacts: boolean): Promise<BriefView | null> {
  const d = await getProspect(db, id, canSeeContacts);
  if (!d) return null;
  const { prospect: p, events, pages, facts, score, contacts, emails } = d;
  const painsEvent = [...events].reverse().find((e) => e.step === "pains" && e.status === "ok");
  const email = emails.filter((e) => e.status !== "held").at(-1) ?? emails.at(-1);
  const chosen = contacts.find((c) => c.chosen);
  const hook = email?.hook as { quote: string; source: string | null } | null | undefined;
  const checks = (await db.select("contact_verifications", { prospect_id: id }, { order: "seq", ascending: false, limit: 20 })) as unknown as { contact_id: string; status: string; score: number | null; created_at: string }[];
  const check = chosen ? checks.find((c) => c.contact_id === String(chosen.id)) : undefined;
  const nameOf = (c: (typeof contacts)[number]) => (canSeeContacts ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "A shared mailbox" : String(c.first_initial ?? "A contact"));
  const { claims, unverified } = await claimsFile(db);
  const input: BriefInput = {
    domain: p.domain,
    pages: pages.map((pg) => ({ url: String(pg.url), kind: String(pg.kind), title: (pg.title as string | null) ?? null, text: String(pg.text ?? "") })),
    lane: p.lane,
    verdict: p.verdict,
    score: score ? Number(score.score) : p.score,
    scoreReason: score ? String(score.reason ?? "") : null,
    parts: arr<BriefInput["parts"][number]>(score?.parts),
    missing: arr<string>(score?.missing),
    facts: (facts.at(-1)?.facts as BriefInput["facts"]) ?? null,
    contact: chosen
      ? {
          id: String(chosen.id),
          name: canSeeContacts ? [chosen.first_name, chosen.last_name].filter(Boolean).join(" ") || "A shared mailbox" : String(chosen.first_initial ?? "A contact"),
          title: (chosen.position as string | null) || null,
          email: canSeeContacts ? ((chosen.email as string | null) ?? null) : null,
          verification: (chosen.verification as string | null) ?? null,
          confidence: chosen.confidence === null || chosen.confidence === undefined ? null : Number(chosen.confidence),
          source: String(chosen.source ?? ""),
          rankScore: chosen.rank_score === null || chosen.rank_score === undefined ? null : Number(chosen.rank_score),
        }
      : null,
    candidates: contacts.filter((c) => !c.excluded).length,
    verified: check ? { status: check.status, score: check.score, at: String(check.created_at) } : null,
    rawFacts: (facts.at(-1)?.facts as BriefInput["rawFacts"]) ?? null,
    others: contacts
      .filter((c) => !c.chosen && !c.excluded)
      .map((c) => ({ name: nameOf(c), title: (c.position as string | null) || null, email: canSeeContacts ? ((c.email as string | null) ?? null) : null, rankScore: c.rank_score === null || c.rank_score === undefined ? null : Number(c.rank_score), source: String(c.source ?? ""), verification: (c.verification as string | null) ?? null })),
    picks: arr<BriefInput["picks"][number]>(painsEvent?.output.picks),
    email: email ? { subject: String(email.subject), body: String(email.body), status: String(email.status), hookQuote: hook?.quote ?? null, hookSource: hook?.source ?? null } : null,
    claims,
    unverifiedClaims: unverified,
  };
  return { prospectId: p.id, runId: p.run_id, lane: p.lane, brief: buildBrief(input) };
}
