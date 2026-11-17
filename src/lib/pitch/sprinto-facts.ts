/**
 * The only things an email may say about Sprinto. Each item carries its source and the person who verified it, and the
 * draft step refuses to run until a person has verified at least one. Gemini is told this file is the sole source of
 * claims about Sprinto; code rejects any figure in a draft that is not on its allowed list (lint L7).
 */

export interface FactsFileItem {
  id: string;
  kind: "audience" | "frameworks" | "proof";
  claim: string;
  sourceUrl: string;
  /** Who checked the claim against its source. Null means nobody has, so it cannot be used. */
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface SprintoFactsFile {
  version: number;
  items: FactsFileItem[];
  sender: { name: string; title: string };
  postalAddress: string;
  /** Figures the email may contain: the ask's length and the framework names' own digits. */
  allowedNumbers: string[];
}

export const PLACEHOLDER = /^\s*$|\[|\bTODO\b|PLACEHOLDER/i;

/**
 * The starting point. Claims come from the case brief, not from sprinto.com (which blocked our research), so none is
 * verified; sender and address are placeholders. A person fills these in before the first draft.
 */
export const SPRINTO_FACTS_SEED: SprintoFactsFile = {
  version: 1,
  items: [
    { id: "F1", kind: "audience", claim: "Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies.", sourceUrl: "Case 02 brief (3 Nov 2026)", verifiedBy: null, verifiedAt: null },
  ],
  sender: { name: "[sender first name]", title: "[sender title]" },
  postalAddress: "[postal address]",
  allowedNumbers: ["2", "27001", "15"],
};

/** What still stands between this file and a first draft. Empty means ready. */
export function factsFileProblems(file: SprintoFactsFile): string[] {
  const problems: string[] = [];
  if (!file.items.some((i) => i.verifiedBy && i.verifiedBy.trim() !== "" && i.verifiedAt)) problems.push("No claim about Sprinto has been verified by a person yet.");
  if (PLACEHOLDER.test(file.sender.name) || PLACEHOLDER.test(file.sender.title)) problems.push("The sender's name and title are not set.");
  if (PLACEHOLDER.test(file.postalAddress)) problems.push("The postal address for the opt-out footer is not set.");
  return problems;
}

export const verifiedClaims = (file: SprintoFactsFile): FactsFileItem[] => file.items.filter((i) => i.verifiedBy && i.verifiedBy.trim() !== "" && i.verifiedAt);

export const optOutFooter = (file: SprintoFactsFile) => `If this isn't relevant, reply "no" and I won't write again. ${file.postalAddress.trim()}`;
