/**
 * The example questions on the Ask page. They name real companies from the records, so an example always has an answer; a fixed
 * list would point at companies that do not exist. Pure, so it is tested.
 */

export interface SuggestionProspect {
  domain: string;
  verdict: string | null;
  lane: string;
}

const GENERAL = ["Who is waiting for a person?", "Which companies had no usable contact?", "How many companies are in each outcome?", "What are the send rules?"];

/** The demo's own companies, which exist only in demo mode. */
export const DEMO_SUGGESTIONS = ["Who is waiting for a person?", "Which companies had no usable contact?", "How many companies are in each outcome?", "Why was petalpop.app not a fit?", "Tell me about harborpay.com", "What are the send rules?"];

/** `prospects` is newest first. A ruled-out company gives "why not a fit"; a company that got furthest gives "tell me about". */
export function askSuggestions(prospects: SuggestionProspect[], demo: boolean): string[] {
  if (demo) return DEMO_SUGGESTIONS;
  const seen = new Set<string>();
  const unique = prospects.filter((p) => (seen.has(p.domain) ? false : (seen.add(p.domain), true)));
  const ruledOut = unique.find((p) => p.verdict === "not_fit");
  const furthest = unique.find((p) => p.lane === "sent") ?? unique.find((p) => p.verdict === "qualified" || p.verdict === "maybe");
  return [
    ...GENERAL.slice(0, 3),
    ...(ruledOut ? [`Why was ${ruledOut.domain} not a fit?`] : []),
    ...(furthest ? [`Tell me about ${furthest.domain}`] : []),
    GENERAL[3]!,
  ];
}
