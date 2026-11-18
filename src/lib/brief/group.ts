/**
 * The other people worth speaking to at a company, and what to lead with for each. A call is not limited to the one person an
 * email goes to: a security lead and an engineering head feel different problems, so each is matched, by code, to the pain their
 * role feels most among those the company's own site gives evidence for. The role weights are the same ones that choose the
 * pains for the email. This is for the call only: the product still emails one person per company within the cooldown.
 */

import { classifyTitle, type Role } from "@/lib/contacts/rank";
import type { Facts } from "@/lib/icp/types";
import { scorePains } from "@/lib/pitch/pains";
import { FRAMING } from "./library";

export const ROLE_LABEL: Record<Role, string> = {
  security_lead: "Security lead",
  grc: "Compliance or GRC lead",
  cto: "CTO",
  eng_head: "Head of engineering",
  it_head: "Head of IT",
  ceo: "Founder or CEO",
  coo: "COO",
};

export interface GroupCandidate {
  name: string;
  title: string | null;
  email: string | null;
  rankScore: number | null;
  source: string;
  verification: string | null;
}

export interface GroupMember {
  name: string;
  title: string | null;
  email: string | null;
  trust: string;
  role: Role | null;
  roleLabel: string | null;
  angle: { id: string; label: string; framing: string; evidence: { text: string; quote: string | null }[] } | null;
  why: string;
}

const trustOf = (c: GroupCandidate) => (c.source === "manual" ? "Hand-picked by a person" : c.verification === "valid" ? "Hunter verified the address" : c.verification ? `Hunter could not fully verify the address (${c.verification})` : "Address not verified");

/**
 * Up to `max` people besides the one chosen, best first, each with the pain their role feels most that the site gives evidence
 * for. `avoid` holds the pains the chosen person's email already uses, so a second voice gets a different angle where one exists.
 */
export function buildGroup(input: { candidates: GroupCandidate[]; facts: Facts | null; avoid: string[]; max?: number }): GroupMember[] {
  const avoid = new Set(input.avoid);
  return [...input.candidates]
    .sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1))
    .slice(0, input.max ?? 3)
    .map((c) => {
      const role = classifyTitle(c.title);
      const scored = input.facts && role ? scorePains(input.facts, role).filter((s) => s.evidence.length > 0).sort((a, b) => b.score - a.score || a.pain.id.localeCompare(b.pain.id)) : [];
      const pick = scored.find((s) => !avoid.has(s.pain.id)) ?? scored[0] ?? null;
      const different = pick ? !avoid.has(pick.pain.id) : false;
      return {
        name: c.name,
        title: c.title,
        email: c.email,
        trust: trustOf(c),
        role,
        roleLabel: role ? ROLE_LABEL[role] : null,
        angle: pick ? { id: pick.pain.id, label: pick.pain.label, framing: FRAMING[pick.pain.id], evidence: pick.evidence.map((e) => ({ text: e.text, quote: e.quotes[0] ?? null })) } : null,
        why: !role
          ? "Their title does not map to a role that owns compliance, so use the general questions."
          : !pick
            ? `${ROLE_LABEL[role]}s feel several of these problems, but the site gives no evidence for one in particular. Use the general questions.`
            : different
              ? `A ${ROLE_LABEL[role].toLowerCase()} feels this one most (${pick.personaPoints} of 30 for the role), and it is a different angle from the first email.`
              : `A ${ROLE_LABEL[role].toLowerCase()} feels this one most (${pick.personaPoints} of 30 for the role). It is the same pain the first email uses; no other has evidence.`,
      };
    });
}
