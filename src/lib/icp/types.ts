/** The structured company facts Gemini extracts. Every fact carries verbatim quotes; code verifies them (see extract/quotes.ts). */

export type Confidence = "high" | "medium" | "low";

export interface Fact<T> {
  /** null means "not found on the pages", never a guess. */
  value: T | null;
  confidence: Confidence;
  quotes: string[];
}

export const unknown = <T>(): Fact<T> => ({ value: null, confidence: "low", quotes: [] });

export type Band = "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1000+";

export interface Facts {
  product: Fact<"saas" | "platform" | "api" | "devtool" | "infra" | "consumer" | "agency" | "other">;
  audience: Fact<"business" | "consumer" | "both">;
  customerData: Fact<"stated" | "implied" | "none">;
  headcount: Fact<Band>;
  enterprisePlan: Fact<boolean>;
  enterpriseLogos: Fact<boolean>;
  enterpriseSecurity: Fact<boolean>; // SSO, SAML, SCIM or audit logs
  compliance: Fact<"in_progress" | "none_visible" | "soc2_type1" | "iso_only" | "soc2_type2" | "soc2_iso">;
  complianceVendor: Fact<"competitor" | "sprinto" | "none">;
  sellsEu: Fact<boolean>;
  gdprStated: Fact<boolean>;
  healthData: Fact<boolean>;
  hipaaStated: Fact<boolean>;
  payments: Fact<boolean>;
  pciStated: Fact<boolean>;
  securityHiring: Fact<"security_role" | "it_head" | "none">;
  recentLaunchOrFunding: Fact<boolean>;
  securityFriction: Fact<boolean>;
  newRegulatedMarket: Fact<boolean>;
}

export function emptyFacts(): Facts {
  return {
    product: unknown(), audience: unknown(), customerData: unknown(), headcount: unknown(),
    enterprisePlan: unknown(), enterpriseLogos: unknown(), enterpriseSecurity: unknown(),
    compliance: unknown(), complianceVendor: unknown(),
    sellsEu: unknown(), gdprStated: unknown(), healthData: unknown(), hipaaStated: unknown(), payments: unknown(), pciStated: unknown(),
    securityHiring: unknown(), recentLaunchOrFunding: unknown(), securityFriction: unknown(), newRegulatedMarket: unknown(),
  };
}

/** Everything the score depends on besides the facts. Supplied by the caller, never by the model. */
export interface ScoreContext {
  /** Sprinto itself, a competitor, an auditor: from the blocklist. */
  excludedDomain: boolean;
  suppressed: boolean;
  textChars: number;
  pages: number;
}

export type Verdict = "qualified" | "maybe" | "not_fit" | "needs_more";

export interface Part {
  id: string;
  group: "fit" | "need" | "timing" | "penalty";
  label: string;
  points: number;
  max: number;
  quotes: string[];
}

export interface Gate {
  id: string;
  label: string;
  /** "fail" ends it as not a fit; "unknown" cannot be judged yet. */
  status: "pass" | "fail" | "unknown";
  detail: string;
}

export interface ScoreResult {
  verdict: Verdict;
  score: number;
  parts: Part[];
  gates: Gate[];
  /** Key facts still unknown. Drives the agent loop and the "needs more" lane. */
  missing: string[];
  flags: string[];
  reason: string;
  icpVersion: number;
}
