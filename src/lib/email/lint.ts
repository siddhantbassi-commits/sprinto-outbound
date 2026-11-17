/**
 * The 12 checks (docs/Sprinto-Outbound-Scope.md section 6.4) a draft must pass before it can be sent.
 * Gemini writes; this decides. A failing draft goes back for at most two repairs, then is held.
 */

export interface LintInput {
  subject: string;
  body: string;
  firstName: string;
  company: string;
  /** The verified quote the hook claims to rest on, or null if the model cited nothing valid. */
  hookQuote: string | null;
  /** Every verified evidence quote for this company: the only sources the email may claim to have used. */
  evidenceQuotes: string[];
  /** Numbers the Sprinto facts file allows (for example "15" for a 15-minute ask). Any other figure in the body is rejected. */
  allowedNumbers: string[];
  /** Must appear verbatim in the body, with the opt-out line. */
  postalAddress: string;
}

export interface LintCheck {
  id: string;
  pass: boolean;
  message: string;
}

const STOP = new Set(["that", "this", "with", "from", "your", "have", "will", "they", "their", "about", "which", "into", "more", "been", "were", "what", "when", "also", "than", "them", "just", "like", "over", "such", "only", "each", "other"]);
const BANNED = [
  "hope this email finds you", "hope this finds you", "i came across", "just following up", "touching base", "circling back",
  "game-changer", "game changer", "revolutionary", "synergy", "guarantee", "cutting-edge", "best-in-class", "world-class", "reach out",
];
const UNSOURCED_CHANNEL = /\b(linkedin|podcast|tweet|twitter|webinar|your post|your talk|saw you (speak|on|at))\b/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const contentWords = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));

export function lintEmail(input: LintInput): { ok: boolean; checks: LintCheck[] } {
  const { subject, body } = input;
  const checks: LintCheck[] = [];
  const add = (id: string, pass: boolean, ok: string, bad: string) => checks.push({ id, pass, message: pass ? ok : bad });

  const wc = words(body).length;
  const letters = subject.replace(/[^A-Za-z]/g, "");
  add("L1", wc >= 60 && wc <= 130 && subject.length > 0 && subject.length <= 60 && !(letters.length > 3 && letters === letters.toUpperCase()) && !/^\s*(re|fwd?)\s*:/i.test(subject),
    `${wc} words; subject fine`,
    `Body must be 60 to 130 words (is ${wc}); subject at most 60 characters, not all capitals, not a fake Re:/Fwd:`);

  const firstLine = body.trimStart().split("\n")[0] ?? "";
  add("L2", firstLine.trim() === `Hi ${input.firstName},`, "Greets the contact by first name", `First line must be exactly "Hi ${input.firstName},"`);

  add("L3", body.toLowerCase().includes(input.company.toLowerCase()), "Names the company", `The body must mention ${input.company}`);

  let hookOk = false;
  if (input.hookQuote) {
    const quoteWords = contentWords(input.hookQuote);
    const bodyWords = contentWords(body);
    hookOk = [...quoteWords].filter((w) => bodyWords.has(w)).length >= 2;
  }
  add("L4", hookOk, "Hook is tied to a verified quote", "Cite a verified quote as the hook and reuse at least two of its content words in the body");

  const questions = (body.match(/\?/g) ?? []).length;
  add("L5", questions === 1, "Exactly one ask", `Needs exactly one question (the ask); found ${questions}`);

  const hasLink = /https?:\/\/|www\./i.test(body);
  const hasEmoji = /\p{Extended_Pictographic}/u.test(body + subject);
  const hasBang = /!/.test(body + subject);
  add("L6", !hasLink && !hasEmoji && !hasBang, "No links, emoji or exclamation marks", "Remove links, emoji and exclamation marks");

  const stripped = body.replace(input.postalAddress, "");
  const numbers = (stripped.match(/\d[\d,.]*%?/g) ?? []).map((n) => n.replace(/[.,]$/, ""));
  const hookNumbers = new Set((input.hookQuote?.match(/\d[\d,.]*%?/g) ?? []).map((n) => n.replace(/[.,]$/, "")));
  const stray = numbers.filter((n) => !input.allowedNumbers.includes(n) && !hookNumbers.has(n));
  add("L7", stray.length === 0, "Every number is sourced", `Unsourced number(s): ${[...new Set(stray)].join(", ")}`);

  const m = body.match(UNSOURCED_CHANNEL);
  const channelOk = !m || input.evidenceQuotes.some((q) => q.toLowerCase().includes((m[1] ?? "").toLowerCase()));
  add("L8", channelOk, "No claim about a source we did not use", `Claims "${m?.[0]}" but that source is not in the evidence`);

  const lower = (body + " " + subject).toLowerCase();
  const banned = BANNED.filter((b) => lower.includes(b));
  add("L9", banned.length === 0, "No banned phrases", `Remove: ${banned.join(", ")}`);

  const optOut = /reply\s+["'“]?no["'”]?/i.test(body);
  const address = input.postalAddress.trim() !== "" && body.includes(input.postalAddress);
  add("L10", optOut && address, "Opt-out line and postal address present", "Needs an opt-out line (reply \"no\") and the postal address");

  const control = /[\u0000-\u001f\u007f]/;
  add("L11", !control.test(subject) && !control.test(input.firstName) && !control.test(input.company), "No control characters in subject or names", "Subject and names must not contain line breaks or control characters");

  const scaffold = /\bas an ai\b|```|\[(your )?(first ?name|name|company|title)\]|\{\{|<[a-z]+>/i.test(body + subject);
  add("L12", !scaffold, "No model scaffolding", "Remove placeholders, markdown fences or AI self-reference");

  return { ok: checks.every((c) => c.pass), checks };
}
