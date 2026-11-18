/**
 * The Why page in a few plain sentences. Written by code from the recorded facts, not by a model, so the summary can never
 * say more than the evidence below it does. Pure, so each sentence is tested.
 */

export interface StoryInput {
  lane: string;
  step: string;
  verdict: string | null;
  score: number | null;
  /** Labels of the rubric parts that added points, strongest first. */
  reasons: string[];
  contact: { name: string; title: string | null } | null;
  candidates: number;
  pains: string[];
  checks: { pass: number; total: number } | null;
  pages: { read: number; thin: number };
  emailStatus: string | null;
  review: { action: "approve" | "reject"; editRatio: number; reason: string } | null;
  laneReason: string | null;
}

export type StoryTone = "good" | "warn" | "bad" | "info";

export interface Story {
  headline: string;
  tone: StoryTone;
  sentences: string[];
  /** What happens next, or what a person has to do. */
  next: { tone: StoryTone; text: string; action?: "review" };
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function story(i: StoryInput): Story {
  const verdict = i.verdict ?? "none";
  const headline = verdict === "qualified" ? "A strong fit" : verdict === "maybe" ? "Worth a second look" : verdict === "not_fit" ? "Not a fit" : "Not assessed yet";
  const tone: StoryTone = verdict === "qualified" ? "good" : verdict === "maybe" ? "warn" : verdict === "not_fit" ? "bad" : "info";

  const sentences: string[] = [];
  if (i.score !== null && verdict !== "none") {
    const why = i.reasons.slice(0, 3).map(lower);
    sentences.push(`Scored ${i.score} out of 100${why.length ? `, because of ${list(why)}` : ""}.`);
  } else if (i.pages.read === 0) sentences.push("No pages could be read, so nothing was scored.");
  if (i.pages.read > 0) sentences.push(`Read ${i.pages.read} ${i.pages.read === 1 ? "page" : "pages"}${i.pages.thin ? `, ${i.pages.thin} of them thin` : ""}.`);
  if (i.contact) sentences.push(`Writing to ${i.contact.name}${i.contact.title ? `, ${i.contact.title}` : ""}${i.candidates > 1 ? `, chosen from ${i.candidates} candidates` : ""}.`);
  if (i.pains.length) sentences.push(`The email leans on ${i.pains.length === 1 ? "this pain" : "these pains"}: ${list(i.pains.map(lower))}.`);
  if (i.checks) sentences.push(i.checks.pass === i.checks.total ? `It passed all ${i.checks.total} checks.` : `It passed ${i.checks.pass} of ${i.checks.total} checks.`);
  if (i.review) {
    if (i.review.action === "reject") sentences.push(`A person rejected the draft${i.review.reason ? `: ${i.review.reason}` : ""}.`);
    else if (i.review.editRatio === 0) sentences.push("A person approved it as written.");
    else sentences.push(`A person edited about ${Math.max(1, Math.round(i.review.editRatio * 100))}% of it before approving.`);
  }

  let next: Story["next"];
  if (i.lane === "sent") next = { tone: "good", text: "Sent to the test inbox. The contact was not mailed." };
  else if (i.lane === "review" && i.step === "drafted" && i.emailStatus === "drafted" && !i.review) next = { tone: "warn", text: "This draft is waiting for your approval.", action: "review" };
  else if (i.lane === "active") next = { tone: "info", text: "In progress. The worker moves it on at its next run." };
  else if (i.lane === "skipped" && i.review?.action === "reject") next = { tone: "bad", text: "Rejected at review. It will not be sent." };
  else if (["failed", "unknown"].includes(i.lane)) next = { tone: "bad", text: i.laneReason ?? "It stopped and needs a person." };
  else next = { tone: "warn", text: i.laneReason ?? "It is waiting for a person." };

  return { headline, tone, sentences, next };
}
