/**
 * The words a discovery-call brief is built from. Written once, by people, and keyed to the same nine pains and the same
 * signals the rest of the pipeline uses, so a brief can never say something the evidence did not trigger. Nothing here is
 * a claim about Sprinto: those come only from the verified facts file. Questions and responses are for the rep to ask and
 * adapt; they are a starting point, not a script.
 */

import type { PainId, SignalId } from "@/lib/pitch/pains";

/** One line per pain on how to frame it in the room. */
export const FRAMING: Record<PainId, string> = {
  P1: "Frame it as revenue: a larger deal waiting on a security report they cannot hand over yet.",
  P2: "Frame it as engineering time: audit evidence pulling people off the product.",
  P3: "Frame it as ownership: compliance has landed on someone whose real job is something else.",
  P4: "Frame it as repeat work: the second framework should not start from zero.",
  P5: "Frame it as manual effort: evidence chased through screenshots and spreadsheets.",
  P6: "Frame it as drag on sales: the same questionnaire answered again for every prospect.",
  P7: "Frame it as staying ready: controls that keep passing between audits, not only on audit day.",
  P8: "Frame it as time and cost: waiting months to hire a first compliance owner.",
  P9: "Frame it as exposure: third-party and vendor reviews piling up as the customer base grows.",
};

/** Questions that uncover the pain, two or three per pain. */
export const QUESTIONS: Record<PainId, string[]> = {
  P1: [
    "Which larger prospect asked you for a security report most recently, and what happened to that deal?",
    "When a buyer asks for SOC 2 today, what do you send them?",
  ],
  P2: [
    "How many engineering hours did your last audit, or your preparation for it, take?",
    "Who gathers the evidence, and what are they not doing while they do it?",
  ],
  P3: [
    "Who owns security and compliance here today, and how much of their week does it take?",
    "What would they do with that time if it were not needed?",
  ],
  P4: [
    "Which framework would you add after the first one, and what is driving that?",
    "How much of the second audit do you expect to be a repeat of the first?",
  ],
  P5: [
    "How do you collect evidence for each control today?",
    "How do you know a control is still passing the week after you proved it?",
  ],
  P6: [
    "How many security questionnaires did you answer last quarter, and who answered them?",
    "How long does one take, and has one ever delayed a signature?",
  ],
  P7: [
    "What happens to your controls between audits?",
    "How would you find out that something drifted before the auditor did?",
  ],
  P8: [
    "How long has the compliance role been open, and what has the search been like?",
    "What happens to the work in the meantime?",
  ],
  P9: [
    "How do you review the vendors that touch your customers' data today?",
    "How many reviews are open right now?",
  ],
};

/** Asked on every call. */
export const UNIVERSAL_QUESTIONS = [
  "Which frameworks have customers or prospects asked you for, and by when?",
  "Who would decide on a tool like this, and who else would need to be comfortable with it?",
  "What have you already tried or looked at?",
];

export interface ObjectionDef {
  says: string;
  /** What to do, not a claim about Sprinto. */
  response: string;
  /** Shown only when one of these signals was found; empty means always. */
  when: SignalId[];
}

export const OBJECTIONS: ObjectionDef[] = [
  {
    says: "We are too small for this right now.",
    response: "Ask what the largest customer or prospect asked for last, and what they would do if a bigger one asks next quarter. Compliance usually arrives as a deal requirement, not a plan.",
    when: ["smallTeam", "noCert"],
  },
  {
    says: "We already have a consultant or an auditor.",
    response: "Do not argue. Ask what the consultant covers after the audit passes: keeping evidence current, the next framework, the questionnaires. The gap is usually the work between audits.",
    when: ["certInProgress"],
  },
  {
    says: "We can manage it with spreadsheets.",
    response: "Ask how many hours the last round took and who did it. Let them hear the number. Ask what happens at twice the size.",
    when: ["certInProgress", "friction", "enterprise"],
  },
  {
    says: "We already have a SOC 2 report, so we are fine.",
    response: "Congratulate them, then ask about the second framework and the day-to-day upkeep. The report is the start of the work, not the end.",
    when: ["oneCertHeld", "type1", "reportHeld"],
  },
  {
    says: "It is not a priority this quarter.",
    response: "Ask what would make it one. If a specific deal or customer is waiting on it, that is the answer. If not, agree a date to check back and note what they said.",
    when: [],
  },
  {
    says: "Send me some information.",
    response: "Offer one page tied to the pain they named instead of a general deck, and ask for 15 minutes to walk through it.",
    when: [],
  },
];

export const SIGNAL_LABEL: Record<string, string> = {
  none_visible: "No SOC 2 or ISO 27001 visible on the site",
  in_progress: "A certification is in progress",
  soc2_type1: "SOC 2 Type 1 held",
  iso_only: "ISO 27001 held",
  soc2_type2: "SOC 2 Type 2 held",
  soc2_iso: "SOC 2 Type 2 and ISO 27001 held",
};
