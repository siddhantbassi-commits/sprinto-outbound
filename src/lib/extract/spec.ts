import type { JsonSchema } from "@/lib/ai/types";
import { emptyFacts, type Confidence, type Facts } from "@/lib/icp/types";

/**
 * The one description of the facts we ask for. The model's output schema, the prompt's field notes and the code that
 * validates the answer all come from this table, so they cannot drift apart.
 */

type Spec = { kind: "enum"; values: readonly string[]; help: string } | { kind: "boolean"; help: string };

export const FACT_SPEC: Record<keyof Facts, Spec> = {
  product: { kind: "enum", values: ["saas", "platform", "api", "devtool", "infra", "consumer", "agency", "other"], help: "What the company sells. saas/platform/api/devtool/infra are software sold to organisations; consumer is for the public; agency is services or consulting." },
  audience: { kind: "enum", values: ["business", "consumer", "both"], help: "Who the product is sold to." },
  customerData: { kind: "enum", values: ["stated", "implied", "none"], help: "Does the product hold customers' data? stated = the pages say so (accounts, uploads, integrations, personal data); implied = the product type clearly would; none = it clearly does not." },
  headcount: { kind: "enum", values: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"], help: "Employee count band. Only from a stated number or clear statement (about page, careers page, 'team of 40'). Otherwise null." },
  enterprisePlan: { kind: "boolean", help: "A plan or tier aimed at large organisations is shown (Enterprise, 'Contact sales' tier)." },
  enterpriseLogos: { kind: "boolean", help: "Named large-company customers are shown (logos or case studies)." },
  enterpriseSecurity: { kind: "boolean", help: "Enterprise security features are listed: SSO, SAML, SCIM or audit logs." },
  compliance: { kind: "enum", values: ["in_progress", "none_visible", "soc2_type1", "iso_only", "soc2_type2", "soc2_iso"], help: "Highest certification status stated. none_visible only when security pages were provided and show no certification at all (give no quotes for it)." },
  complianceVendor: { kind: "enum", values: ["competitor", "sprinto", "none"], help: "Is a compliance-automation vendor's trust centre or badge visible (Vanta, Drata, Secureframe, Thoropass and similar = competitor; Sprinto = sprinto)? none only when pages were provided and show none (give no quotes for it)." },
  sellsEu: { kind: "boolean", help: "Sells to, or is based in, the EU/UK, or mentions GDPR-relevant European customers." },
  gdprStated: { kind: "boolean", help: "GDPR is mentioned on the pages." },
  healthData: { kind: "boolean", help: "Handles health or patient data." },
  hipaaStated: { kind: "boolean", help: "HIPAA is mentioned." },
  payments: { kind: "boolean", help: "Takes or processes card payments." },
  pciStated: { kind: "boolean", help: "PCI DSS is mentioned." },
  securityHiring: { kind: "enum", values: ["security_role", "it_head", "none"], help: "Open roles: security_role = a security, GRC or compliance role; it_head = a head of IT; none only when a careers page was provided and shows neither (give no quotes for it)." },
  recentLaunchOrFunding: { kind: "boolean", help: "A funding round, product launch or enterprise tier announced in roughly the last year." },
  securityFriction: { kind: "boolean", help: "Signs of security-review friction: a request-access trust page, security questionnaires, 'ask for our security report'." },
  newRegulatedMarket: { kind: "boolean", help: "Newly entering a regulated market or region (healthcare, finance, EU, government)." },
};

/** Values that mean "we looked and found nothing". A quote cannot prove them, so code checks them (see absence.ts). */
export const ABSENCE_VALUES: Partial<Record<keyof Facts, string>> = {
  compliance: "none_visible",
  complianceVendor: "none",
  securityHiring: "none",
};

export const MAX_QUOTES = 3;
export const MAX_QUOTE_CHARS = 200;

export function factsSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [key, spec] of Object.entries(FACT_SPEC)) {
    properties[key] = {
      type: "object",
      description: spec.help,
      properties: {
        value: spec.kind === "enum" ? { type: "string", enum: [...spec.values], nullable: true } : { type: "boolean", nullable: true },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        quotes: { type: "array", items: { type: "string" }, maxItems: MAX_QUOTES },
      },
      required: ["value", "confidence", "quotes"],
    };
  }
  return { type: "object", properties, required: Object.keys(properties) };
}

const isConfidence = (v: unknown): v is Confidence => v === "high" || v === "medium" || v === "low";

/**
 * Reads the model's answer into Facts. Anything off-spec (a value outside the enum, a wrong type, a missing field)
 * becomes unknown and is listed as a problem, so a malformed answer can never become a score input.
 */
export function parseFacts(raw: unknown): { facts: Facts; problems: string[] } {
  const facts = emptyFacts() as unknown as Record<string, { value: unknown; confidence: Confidence; quotes: string[] }>;
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { facts: facts as unknown as Facts, problems: ["The answer was not an object"] };
  const obj = raw as Record<string, unknown>;
  for (const [key, spec] of Object.entries(FACT_SPEC)) {
    const entry = obj[key];
    if (entry === undefined) {
      problems.push(`${key}: missing`);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${key}: not an object`);
      continue;
    }
    const { value, confidence, quotes } = entry as Record<string, unknown>;
    if (value === null || value === undefined) continue;
    const valid = spec.kind === "boolean" ? typeof value === "boolean" : typeof value === "string" && spec.values.includes(value);
    if (!valid) {
      problems.push(`${key}: value outside the allowed set`);
      continue;
    }
    const cleanQuotes = Array.isArray(quotes)
      ? quotes.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, MAX_QUOTES).map((q) => q.trim().slice(0, MAX_QUOTE_CHARS))
      : [];
    if (!isConfidence(confidence)) problems.push(`${key}: confidence missing, treated as low`);
    (facts[key] as { value: unknown; confidence: Confidence; quotes: string[] }) = { value, confidence: isConfidence(confidence) ? confidence : "low", quotes: cleanQuotes };
  }
  return { facts: facts as unknown as Facts, problems };
}
