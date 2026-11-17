import { normaliseText } from "./quotes";
import { ABSENCE_VALUES } from "./spec";
import type { Facts } from "@/lib/icp/types";

/**
 * "We looked and found nothing" cannot carry a quote, so the grounding check would throw it away. Code decides these
 * three instead: the model may suggest an absence, but it only stands if the stored text really contains none of the
 * markers, and enough of the site was actually read for the absence to mean something.
 */

/** Compliance-automation vendors. A visible one is a competitor signal (and a penalty in the score). */
export const COMPETITOR_NAMES = [
  "vanta", "drata", "secureframe", "thoropass", "scrut", "laika", "tugboat logic", "hyperproof", "anecdotes", "trustcloud",
  "strike graph", "cyberarrow", "auditboard", "onetrust", "trustarc", "sprinto",
];

const CERT_MARKERS = /\bsoc\s?-?\s?2\b|\bsoc2\b|\biso\s?\/?\s?(iec\s?)?-?\s?27001\b|\b27001\b/i;
const SECURITY_ROLE = /\b(security|infosec|grc|compliance|devsecops|appsec|information security)\b.{0,40}\b(engineer|manager|analyst|lead|head|director|officer|architect)\b|\b(ciso|head of security|head of compliance)\b/i;

export interface PageText {
  kind: string;
  text: string;
}

export interface AbsenceResult {
  facts: Facts;
  /** Absence facts that the code confirmed. */
  derived: string[];
  /** Absence claims the stored text contradicts, or that too little was read to support. */
  rejected: string[];
}

const mentionsCompetitor = (haystack: string) => COMPETITOR_NAMES.some((n) => new RegExp(`\\b${n.replace(/\s/g, "\\s")}\\b`, "i").test(haystack));

/**
 * `modelFacts` is what the model returned (before grounding); `grounded` is after. For each absence value the model
 * claimed, the rule decides. A fact the model did not claim as an absence is left exactly as grounding left it.
 */
export function applyAbsences(modelFacts: Facts, grounded: Facts, pages: PageText[]): AbsenceResult {
  const facts = structuredClone(grounded);
  const derived: string[] = [];
  const rejected: string[] = [];
  const text = normaliseText(pages.map((p) => p.text).join("\n"));
  const read = pages.length >= 2;
  const hasCareers = pages.some((p) => p.kind === "careers");

  const rules: Record<string, () => boolean> = {
    compliance: () => read && !CERT_MARKERS.test(text),
    complianceVendor: () => read && !mentionsCompetitor(text),
    securityHiring: () => hasCareers && !SECURITY_ROLE.test(pages.filter((p) => p.kind === "careers").map((p) => p.text).join("\n")),
  };

  for (const [key, absent] of Object.entries(ABSENCE_VALUES)) {
    const claimed = (modelFacts as unknown as Record<string, { value: unknown }>)[key]?.value === absent;
    if (!claimed) continue;
    const target = (facts as unknown as Record<string, { value: unknown; confidence: string; quotes: string[] }>)[key]!;
    if (rules[key]!()) {
      target.value = absent;
      target.confidence = "medium";
      target.quotes = [];
      derived.push(key);
    } else {
      target.value = null;
      target.confidence = "low";
      target.quotes = [];
      rejected.push(key);
    }
  }
  return { facts, derived, rejected };
}
