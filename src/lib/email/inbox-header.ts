/**
 * Test mode's defence, delivered in the inbox. Above the email, separated by a rule, the owner reads who it would have
 * gone to and why: the qualification, the reason this person beat the runner-up, the pains, and where the hook came from.
 * The email itself is untouched below the rule, so what is linted is exactly what a real send would carry.
 */

export interface HeaderInput {
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
  company: string;
  domain: string;
  /** Hunter's verification status and confidence, as plain facts. */
  emailVerification: string | null;
  emailConfidence: number | null;
  verdict: string;
  score: number;
  /** The strongest reasons the company scored, each with its evidence. */
  reasons: { label: string; quote: string | null }[];
  chosenScore: number;
  runnerUp: { name: string; title: string | null; score: number } | null;
  pains: { id: string; label: string }[];
  hookSource: string | null;
  traceUrl: string | null;
}

export const RULE = "-".repeat(56);

/** Header text is shown, not trusted: one line, no control characters, bounded length. */
const line = (s: string | null | undefined, max = 160) =>
  (s ?? "")
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function buildInboxHeader(h: HeaderInput): string {
  const who = [line(h.contactName, 80), line(h.contactTitle, 80) && `${line(h.contactTitle, 80)} at ${line(h.company, 80)}`].filter(Boolean).join(", ");
  const email = h.contactEmail ? ` <${line(h.contactEmail, 120)}>` : "";
  const proof = [h.emailVerification && `email ${line(h.emailVerification, 30)}`, h.emailConfidence !== null && `confidence ${Math.round(h.emailConfidence)}`].filter(Boolean).join(", ");
  const lines = [
    "TEST MODE. This message was sent to you only. It was NOT sent to the contact.",
    `Would have gone to: ${who}${email}${proof ? ` (${proof})` : ""}`,
    `Qualified: ${h.verdict} ${Math.round(h.score)}/100.${h.reasons.length ? ` ${h.reasons.slice(0, 3).map((r) => (r.quote ? `${line(r.label, 80)} ("${line(r.quote, 120)}")` : line(r.label, 80))).join("; ")}.` : ""}`,
    `Chosen contact scored ${Math.round(h.chosenScore)}${h.runnerUp ? `; over ${line(h.runnerUp.name, 80)}${h.runnerUp.title ? `, ${line(h.runnerUp.title, 80)}` : ""}, ${Math.round(h.runnerUp.score)}` : " (no runner-up)"}.`,
    `Pains: ${h.pains.length ? h.pains.map((p) => `${line(p.id, 10)} ${line(p.label, 80)}`).join("; ") : "none recorded"}.`,
    `Hook source: ${line(h.hookSource, 200) || "none recorded"}.`,
    ...(h.traceUrl ? [`Full trace: ${line(h.traceUrl, 300)}`] : []),
  ];
  return lines.join("\n");
}

/** The header, a rule, then the email exactly as drafted. */
export function composeTestBody(header: string, body: string): string {
  return `${header}\n${RULE}\n\n${body}`;
}
