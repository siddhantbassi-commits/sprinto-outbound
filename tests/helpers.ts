import { emptyFacts, type Confidence, type Facts, type Fact } from "@/lib/icp/types";

/** Sets one fact with a quote, so tests read like the evidence a real page would give. */
export function fact<T>(value: T, quote = "quoted from the page", confidence: Confidence = "high"): Fact<T> {
  return { value, confidence, quotes: [quote] };
}

/** A strong fit: B2B SaaS, 51-200 people, enterprise motion, SOC 2 in progress, hiring security. */
export function strongFacts(): Facts {
  return {
    ...emptyFacts(),
    product: fact("saas"), audience: fact("business"), customerData: fact("stated"), headcount: fact("51-200"),
    enterprisePlan: fact(true), enterpriseLogos: fact(true), enterpriseSecurity: fact(true),
    compliance: fact("in_progress"), complianceVendor: fact("none"),
    sellsEu: fact(true), gdprStated: fact(false),
    securityHiring: fact("security_role"),
    recentLaunchOrFunding: fact(true), securityFriction: fact(true), newRegulatedMarket: fact(false),
  };
}

export const CTX = { excludedDomain: false, suppressed: false, textChars: 5000, pages: 4 };
