import { selectAll } from "@/lib/db/all";
import type { DbPort, Row } from "@/lib/db/port";
import { companyName } from "@/lib/pitch/company";
import { standings, type Standing } from "./outcomes";

export interface Lead {
  id: string;
  runId: string;
  domain: string;
  name: string;
  verdict: string | null;
  score: number | null;
  lane: string;
  updatedAt: string;
  reasons: string[];
  contact: { name: string; title: string | null } | null;
  pains: string[];
  emailStatus: string | null;
  /** Where it stands after outreach, from the newest recorded outcome. Null when nothing has been recorded. */
  outcome: Standing | null;
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Every researched company with what a person needs to decide who to call: how well it fits, why, who to speak to, what the
 * two pains are, and where its email stands. One page of reads, joined here, so the Leads page is a single list.
 */
export async function listLeads(db: DbPort, canSeeContacts: boolean, limit = 300): Promise<Lead[]> {
  const every = await selectAll(db, "prospects", {}, { order: "updated_at", ascending: false, columns: "id,run_id,domain,lane,verdict,score,updated_at" }, limit * 3);
  // A company researched more than once is one lead: its newest row that was actually judged, or failing that its newest row.
  // A later run that skipped it (already mailed, say) must not hide the research that was done.
  const pick = new Map<string, Row>();
  for (const p of every) {
    const have = pick.get(String(p.domain));
    if (!have || (have.verdict === null && p.verdict !== null)) pick.set(String(p.domain), p);
  }
  const prospects = every.filter((p) => pick.get(String(p.domain)) === p).slice(0, limit);
  if (prospects.length === 0) return [];
  const homes = await selectAll(db, "pages", { kind: "home" }, { order: "created_at", ascending: false, columns: "prospect_id,title" }, 3000);
  const scores = await selectAll(db, "scores", { replay: false }, { order: "created_at", ascending: false, columns: "prospect_id,parts" }, 3000);
  const contacts = canSeeContacts
    ? await selectAll(db, "contacts", { chosen: true }, { order: "created_at", ascending: false, columns: "prospect_id,first_name,last_name,position,email" }, 3000)
    : await selectAll(db, "contacts_masked", { chosen: true }, { order: "created_at", ascending: false, columns: "prospect_id,first_initial,position" }, 3000);
  const pains = await selectAll(db, "step_events", { step: "pains", status: "ok" }, { order: "id", ascending: false, columns: "prospect_id,output" }, 3000);
  const outcomes = standings((await selectAll(db, "lead_outcomes", {}, { order: "seq", columns: "prospect_id,seq,status,note,follow_up_on,created_at" }, 5000)) as never);
  const emails = await selectAll(db, "emails", {}, { order: "created_at", ascending: false, columns: "prospect_id,status" }, 3000);

  const first = (rows: Row[]) => {
    const m = new Map<string, Row>();
    for (const r of rows) if (!m.has(String(r.prospect_id))) m.set(String(r.prospect_id), r);
    return m;
  };
  const scoreBy = first(scores);
  const contactBy = first(contacts);
  const painBy = first(pains);
  const emailBy = first(emails);
  const homeBy = first(homes);

  return prospects.map((p) => {
    const id = String(p.id);
    const parts = arr<{ label: string; points: number }>(scoreBy.get(id)?.parts).filter((x) => x.points > 0).sort((a, b) => b.points - a.points);
    const c = contactBy.get(id);
    const picks = arr<{ label: string }>((painBy.get(id)?.output as { picks?: unknown } | undefined)?.picks);
    return {
      id,
      runId: String(p.run_id),
      domain: String(p.domain),
      name: companyName(String(p.domain), (homeBy.get(id)?.title as string | null | undefined) ?? null),
      verdict: (p.verdict as string | null) ?? null,
      score: p.score === null || p.score === undefined ? null : Number(p.score),
      lane: String(p.lane),
      updatedAt: String(p.updated_at),
      reasons: parts.slice(0, 3).map((x) => x.label),
      contact: c ? { name: canSeeContacts ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "A shared mailbox" : String(c.first_initial ?? "A contact"), title: (c.position as string | null) || null } : null,
      pains: picks.map((x) => x.label),
      emailStatus: emailBy.has(id) ? String(emailBy.get(id)!.status) : null,
      outcome: outcomes.get(id) ?? null,
    };
  });
}

export type LeadFilter = "ready" | "all";

/** Leads worth calling: scored a strong or possible fit, and not already a clear no. Everything else stays under "All researched". */
export const isCallable = (l: Lead) => (l.verdict === "qualified" || l.verdict === "maybe") && l.outcome?.status !== "not_interested";
