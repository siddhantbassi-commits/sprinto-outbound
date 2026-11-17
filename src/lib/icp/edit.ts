import type { IcpConfig } from "./config";
import type { Band } from "./types";

/**
 * Editing the ICP. The rubric is a fixed shape with numbers in it; this turns a form into a checked config, describes a
 * config in plain words, and says what changed between two. Only numbers can be edited: the facts, the gates and the
 * scoring rules are code, so a typo in a weight cannot change what the system is allowed to do.
 */

export interface Field {
  /** Also the form field's name. */
  name: string;
  label: string;
  group: "Thresholds" | "Fit" | "Need" | "Timing" | "Penalty" | "Reading enough";
  min: number;
  max: number;
  help?: string;
  get(c: IcpConfig): number;
  set(c: IcpConfig, v: number): void;
}

const BANDS: Band[] = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];
const STATUSES = ["in_progress", "none_visible", "soc2_type1", "iso_only", "soc2_type2", "soc2_iso"] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  in_progress: "Certification in progress",
  none_visible: "No certification visible",
  soc2_type1: "SOC 2 Type 1 held",
  iso_only: "ISO 27001 only",
  soc2_type2: "SOC 2 Type 2 held",
  soc2_iso: "SOC 2 Type 2 and ISO 27001 both held",
};

const f = (name: string, label: string, group: Field["group"], min: number, max: number, get: Field["get"], set: Field["set"], help?: string): Field => ({ name, label, group, min, max, get, set, help });

export const FIELDS: Field[] = [
  f("qualifyAt", "Qualified at this score or above", "Thresholds", 2, 100, (c) => c.qualifyAt, (c, v) => (c.qualifyAt = v), "These go straight on to find a person."),
  f("maybeAt", "Maybe from this score", "Thresholds", 1, 99, (c) => c.maybeAt, (c, v) => (c.maybeAt = v), "These wait for a person to promote them. Below it, not a fit."),
  f("customerData.stated", "Customer data is stated", "Fit", 0, 50, (c) => c.points.customerData.stated, (c, v) => (c.points.customerData.stated = v), "The pages say the product holds customers' data."),
  f("customerData.implied", "Customer data is implied", "Fit", 0, 50, (c) => c.points.customerData.implied, (c, v) => (c.points.customerData.implied = v), "The product type clearly would."),
  f("enterprise.plan", "Has an Enterprise plan", "Fit", 0, 50, (c) => c.points.enterprise.plan, (c, v) => (c.points.enterprise.plan = v)),
  f("enterprise.logos", "Shows large named customers", "Fit", 0, 50, (c) => c.points.enterprise.logos, (c, v) => (c.points.enterprise.logos = v)),
  f("enterprise.security", "Lists SSO, SAML, SCIM or audit logs", "Fit", 0, 50, (c) => c.points.enterprise.security, (c, v) => (c.points.enterprise.security = v)),
  ...BANDS.map((b) => f(`size.${b}`, `Company size ${b}`, "Fit", 0, 50, (c) => c.points.size[b], (c, v) => (c.points.size[b] = v))),
  ...STATUSES.map((s) => f(`status.${s}`, STATUS_LABEL[s], "Need", 0, 50, (c) => c.points.status[s], (c, v) => (c.points.status[s] = v))),
  f("gap.eu", "Sells in the EU without mentioning GDPR", "Need", 0, 50, (c) => c.points.gap.eu, (c, v) => (c.points.gap.eu = v)),
  f("gap.health", "Handles health data without mentioning HIPAA", "Need", 0, 50, (c) => c.points.gap.health, (c, v) => (c.points.gap.health = v)),
  f("gap.payments", "Takes payments without mentioning PCI", "Need", 0, 50, (c) => c.points.gap.payments, (c, v) => (c.points.gap.payments = v)),
  f("gap.cap", "Most the framework gaps can add together", "Need", 0, 50, (c) => c.points.gap.cap, (c, v) => (c.points.gap.cap = v)),
  f("hiring.security_role", "Hiring a security or GRC role", "Need", 0, 50, (c) => c.points.hiring.security_role, (c, v) => (c.points.hiring.security_role = v)),
  f("hiring.it_head", "Hiring a head of IT", "Need", 0, 50, (c) => c.points.hiring.it_head, (c, v) => (c.points.hiring.it_head = v)),
  f("timing.recent", "Funded or launched in the last year", "Timing", 0, 50, (c) => c.points.timing.recent, (c, v) => (c.points.timing.recent = v)),
  f("timing.friction", "Signs of security-review friction", "Timing", 0, 50, (c) => c.points.timing.friction, (c, v) => (c.points.timing.friction = v)),
  f("timing.market", "Entering a new regulated market", "Timing", 0, 50, (c) => c.points.timing.market, (c, v) => (c.points.timing.market = v)),
  f("competitorPenalty", "Points taken off when a competitor's trust page is visible", "Penalty", 0, 50, (c) => c.points.competitorPenalty, (c, v) => (c.points.competitorPenalty = v)),
  f("minChars", "Characters of page text needed to judge", "Reading enough", 0, 20_000, (c) => c.minChars, (c, v) => (c.minChars = v)),
  f("minPages", "Pages needed to judge", "Reading enough", 1, 12, (c) => c.minPages, (c, v) => (c.minPages = v)),
  f("minKnownKeyFacts", "Key facts (of six) that must be known", "Reading enough", 1, 6, (c) => c.minKnownKeyFacts, (c, v) => (c.minKnownKeyFacts = v), "Below this the company is “needs more”, never guessed."),
];

export const FIELD_NAMES = FIELDS.map((x) => x.name);

const clone = (c: IcpConfig): IcpConfig => structuredClone(c);

/** Every editable number as form values, keyed by field name. */
export const configToValues = (c: IcpConfig): Record<string, number> => Object.fromEntries(FIELDS.map((x) => [x.name, x.get(c)]));

export type ParseResult = { ok: true; config: IcpConfig } | { ok: false; errors: string[] };

/**
 * Builds a config from form values on top of a base. Every field must be a whole number in its range; anything else is
 * named in the errors, and nothing partial is returned. The version is left as the base's: saving is what advances it.
 */
export function parseConfigForm(get: (name: string) => string | null | undefined, base: IcpConfig): ParseResult {
  const next = clone(base);
  const errors: string[] = [];
  for (const field of FIELDS) {
    const raw = (get(field.name) ?? "").trim();
    if (raw === "" || !/^-?\d+$/.test(raw)) {
      errors.push(`${field.label}: enter a whole number.`);
      continue;
    }
    const v = Number(raw);
    if (v < field.min || v > field.max) {
      errors.push(`${field.label}: must be between ${field.min} and ${field.max}.`);
      continue;
    }
    field.set(next, v);
  }
  if (errors.length === 0 && next.qualifyAt <= next.maybeAt) errors.push('"Qualified at" must be higher than "maybe from".');
  return errors.length ? { ok: false, errors } : { ok: true, config: next };
}

/** The most the rubric can add up to before the 100-point cap: the strongest case in each part. */
export function maxPoints(c: IcpConfig): number {
  const p = c.points;
  const gap = Math.min(p.gap.eu + p.gap.health + p.gap.payments, p.gap.cap);
  return p.customerData.stated + p.enterprise.plan + p.enterprise.logos + p.enterprise.security + Math.max(...Object.values(p.size)) + Math.max(...Object.values(p.status)) + gap + Math.max(p.hiring.security_role, p.hiring.it_head) + p.timing.recent + p.timing.friction + p.timing.market;
}

export interface Change {
  name: string;
  label: string;
  from: number;
  to: number;
}

export const diffConfig = (a: IcpConfig, b: IcpConfig): Change[] => FIELDS.filter((x) => x.get(a) !== x.get(b)).map((x) => ({ name: x.name, label: x.label, from: x.get(a), to: x.get(b) }));

export interface Described {
  title: string;
  lines: string[];
}

/** The rubric in plain words, so the person who owns it can read it without reading code. */
export function describeRubric(c: IcpConfig): Described[] {
  const p = c.points;
  const sizes = BANDS.map((b) => `${b}: ${p.size[b]}`).join(", ");
  const statuses = STATUSES.map((s) => `${STATUS_LABEL[s].toLowerCase()}: ${p.status[s]}`).join("; ");
  return [
    {
      title: "Who is ruled out first (gates)",
      lines: [
        "Not business software (a consumer app, an agency): not a fit.",
        "On the blocklist (Sprinto, a competitor), already a Sprinto customer, or suppressed: not a fit.",
        "Over 1,000 people: not a fit.",
        `Fewer than ${c.minPages} pages or ${c.minChars.toLocaleString("en-GB")} characters read, or fewer than ${c.minKnownKeyFacts} of the six key facts known: needs more, never guessed.`,
      ],
    },
    {
      title: "Fit",
      lines: [`Customer data in the cloud: ${p.customerData.stated} if stated, ${p.customerData.implied} if implied.`, `Sells to businesses: ${p.enterprise.plan} for an Enterprise plan, ${p.enterprise.logos} for large named customers, ${p.enterprise.security} for SSO, SAML, SCIM or audit logs.`, `Company size: ${sizes}.`],
    },
    {
      title: "Need",
      lines: [`Compliance status: ${statuses}.`, `A framework they do not mention: ${p.gap.eu} for the EU without GDPR, ${p.gap.health} for health data without HIPAA, ${p.gap.payments} for payments without PCI, at most ${p.gap.cap} together.`, `Hiring: ${p.hiring.security_role} for a security or GRC role, ${p.hiring.it_head} for a head of IT.`],
    },
    { title: "Timing", lines: [`Funded or launched in the last year: ${p.timing.recent}. Security-review friction: ${p.timing.friction}. A new regulated market: ${p.timing.market}.`] },
    { title: "Penalty", lines: [`A competitor's trust page visible: minus ${p.competitorPenalty}.`] },
    {
      title: "The verdict",
      lines: [`${c.qualifyAt} or more: qualified, and a person is found.`, `${c.maybeAt} to ${c.qualifyAt - 1}: maybe, held for a person to promote.`, `Below ${c.maybeAt}: not a fit, with the reason kept.`, `Every part is capped so the total cannot pass 100. The strongest case adds up to ${maxPoints(c)} before that cap.`],
    },
  ];
}
