import type { Band } from "@/lib/icp/types";

/**
 * Step 4's choice of person. Candidates come from Hunter or a hand-picked Apollo row; code ranks them, so the choice is
 * explainable number by number and never depends on Hunter's own labels or on the model.
 */

export interface Candidate {
  source: "hunter" | "manual";
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  email: string | null;
  type: "personal" | "generic" | null;
  seniority: "executive" | "senior" | "junior" | null;
  department: string | null;
  /** 0 to 100, Hunter's own confidence. */
  confidence: number | null;
  verification: "valid" | "accept_all" | "unknown" | "invalid" | "disposable" | "webmail" | null;
}

export type Role = "security_lead" | "grc" | "cto" | "eng_head" | "it_head" | "ceo" | "coo";

/** Points a role earns by company size. Unknown size uses the middle band and is flagged by the caller. */
export const TITLE_POINTS: Record<Band | "unknown", Partial<Record<Role, number>>> = {
  "1-10": { cto: 50, ceo: 45, eng_head: 40, security_lead: 40, coo: 30 },
  "11-50": { cto: 50, ceo: 45, eng_head: 40, security_lead: 40, coo: 30 },
  "51-200": { security_lead: 50, grc: 50, cto: 42, eng_head: 38, it_head: 35, coo: 25, ceo: 20 },
  "201-500": { security_lead: 50, grc: 50, cto: 30, eng_head: 30, it_head: 28 },
  "501-1000": { security_lead: 50, grc: 50, cto: 30, eng_head: 30, it_head: 28 },
  "1000+": { security_lead: 50, grc: 50 },
  unknown: { security_lead: 50, grc: 50, cto: 42, eng_head: 38, it_head: 35, coo: 25, ceo: 20 },
};

const GENERIC_LOCAL = /^(info|hello|hi|contact|support|help|sales|team|admin|office|mail|press|jobs|careers|hr|billing|security|privacy|legal|noreply|no-reply)$/i;
const NOT_OUR_PERSON =
  /\b(sales|marketing|hr|human resources|recruit\w*|talent|intern|student|customer success|support|account executive|sdr|bdr|designer|content|growth|partnerships?)\b/i;

/** The first role a title matches, most specific first. null means this is not someone who owns compliance. */
export function classifyTitle(title: string | null): Role | null {
  if (!title) return null;
  const t = title.toLowerCase();
  const security = /\b(ciso|chief information security|chief security|head of (information )?security|(vp|vice president),? (of )?(information )?security|director,? (of )?(information )?security|security lead|security director)\b/.test(t);
  const grc = /\b(grc|compliance|governance|risk)\b/.test(t) && /\b(head|vp|vice president|director|lead|manager|chief|officer)\b/.test(t);
  if (security) return "security_lead";
  if (grc) return "grc";
  if (NOT_OUR_PERSON.test(t)) return null;
  if (/\bcto\b|chief technology officer|technical co-?founder/.test(t)) return "cto";
  if (/\b(vp|vice president|head|director)\b.*\bengineering\b|\bengineering\b.*\b(vp|head|director)\b/.test(t)) return "eng_head";
  if (/\bhead of it\b|\bit director\b|director of it\b|\bit manager\b/.test(t)) return "it_head";
  if (/\bcoo\b|chief operating/.test(t)) return "coo";
  if (/\bceo\b|chief executive|\bfounder\b|co-?founder/.test(t)) return "ceo";
  return null;
}

export interface RankPart {
  label: string;
  points: number;
}

export interface Ranked {
  candidate: Candidate;
  role: Role | null;
  score: number;
  parts: RankPart[];
  excluded: string | null;
}

const FIT_DEPARTMENTS = new Set(["security", "it", "executive", "engineering", "management"]);

export function rankCandidate(c: Candidate, band: Band | null): Ranked {
  const fail = (reason: string): Ranked => ({ candidate: c, role: null, score: 0, parts: [], excluded: reason });

  if (!c.email || !c.email.includes("@")) return fail("No email address");
  if (c.type === "generic" || GENERIC_LOCAL.test(c.email.split("@")[0] ?? "")) return fail("A shared mailbox, not a person");
  const first = (c.firstName ?? "").trim();
  const last = (c.lastName ?? "").trim();
  if (first.length < 2 || last.length < 2) return fail("No full name");
  if (c.seniority === "junior") return fail("A junior title");
  if (c.verification === "invalid" || c.verification === "disposable") return fail(`Email checked as ${c.verification}`);

  const role = classifyTitle(c.position);
  if (!role) return fail("Title is not a compliance owner");
  const titlePts = TITLE_POINTS[band ?? "unknown"][role] ?? 0;
  if (titlePts === 0) return fail(`A ${role.replace("_", " ")} is not the buyer at this size`);

  const parts: RankPart[] = [{ label: `title (${c.position}) for ${band ?? "unknown"} size`, points: titlePts }];
  parts.push({ label: c.seniority ?? "seniority unknown", points: c.seniority === "executive" ? 15 : c.seniority === "senior" ? 10 : 0 });
  const v = c.verification;
  parts.push({ label: `email ${v ?? "unchecked"}`, points: v === "valid" ? 20 : v === "accept_all" ? 8 : 3 });
  const conf = c.confidence ?? 0;
  parts.push({ label: `confidence ${conf}`, points: conf >= 90 ? 10 : conf >= 70 ? 6 : 2 });
  parts.push({ label: `department ${c.department ?? "unknown"}`, points: c.department && FIT_DEPARTMENTS.has(c.department.toLowerCase()) ? 5 : 0 });

  return { candidate: c, role, score: parts.reduce((s, p) => s + p.points, 0), parts, excluded: null };
}

const verifiedRank = (v: Candidate["verification"]) => (v === "valid" ? 2 : v === "accept_all" ? 1 : 0);

export interface Choice {
  chosen: Ranked | null;
  runnerUp: Ranked | null;
  ranked: Ranked[];
  excluded: Ranked[];
  explanation: string;
}

/** Ranks everyone, picks one, and writes the reason from the numbers. A hand-picked contact always wins over Hunter. */
export function chooseContact(candidates: Candidate[], band: Band | null): Choice {
  const all = candidates.map((c) => rankCandidate(c, band));
  const ok = all.filter((r) => r.excluded === null);
  const excluded = all.filter((r) => r.excluded !== null);
  ok.sort(
    (a, b) =>
      Number(b.candidate.source === "manual") - Number(a.candidate.source === "manual") ||
      b.score - a.score ||
      verifiedRank(b.candidate.verification) - verifiedRank(a.candidate.verification) ||
      (b.candidate.confidence ?? 0) - (a.candidate.confidence ?? 0) ||
      `${a.candidate.lastName}${a.candidate.firstName}`.localeCompare(`${b.candidate.lastName}${b.candidate.firstName}`),
  );
  const chosen = ok[0] ?? null;
  const runnerUp = ok[1] ?? null;
  if (!chosen) {
    return { chosen, runnerUp, ranked: ok, excluded, explanation: `No suitable contact: ${all.length} candidate(s), all excluded.` };
  }
  const bits = chosen.parts.map((p) => `${p.label} ${p.points}`).join(", ");
  const manual = chosen.candidate.source === "manual" ? " (hand-picked, so it outranks Hunter)" : "";
  const runner = runnerUp ? ` Runner-up: ${runnerUp.candidate.position}, ${runnerUp.score}.` : "";
  return {
    chosen, runnerUp, ranked: ok, excluded,
    explanation: `Chosen: ${chosen.candidate.position}${manual}, ${chosen.score} (${bits}).${runner}`,
  };
}
