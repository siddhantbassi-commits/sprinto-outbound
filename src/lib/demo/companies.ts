import type { Candidate } from "@/lib/contacts/rank";

/**
 * The sample companies for demo mode. They are invented; nothing here is a real company except `vanta.com`, which is
 * included only because the product refuses to write to competitors and that is worth being able to show.
 * Each company's pages are generated from the sentences below, and the pretend model quotes those same sentences,
 * so the real quote-checking code has real text to check against.
 */

export interface Sentences {
  product: string;
  funding?: string;
  plan?: string;
  data?: string;
  cert?: string;
  friction?: string;
  size?: string;
  eu?: string;
  health?: string;
  payments?: string;
  logos?: string;
  hiring?: string;
}

export interface DemoCompany {
  domain: string;
  name: string;
  /** "thin" is a page that only renders in JavaScript, so there is almost no text to read. */
  kind: "strong" | "consumer" | "thin" | "competitor";
  s: Sentences;
  compliance: "in_progress" | "none_visible" | "soc2_type1" | "soc2_type2" | "soc2_iso" | null;
  band: "1-10" | "11-50" | "51-200" | "201-500" | null;
  hiring: "security_role" | "none" | null;
  contacts: Candidate[];
}

const person = (first: string, last: string, position: string, dept: string, seniority: Candidate["seniority"], domain: string, confidence = 92): Candidate => ({
  source: "hunter", firstName: first, lastName: last, position, email: `${first.toLowerCase()}@${domain}`, type: "personal", seniority, department: dept, confidence, verification: "valid",
});
const generic = (domain: string): Candidate => ({ source: "hunter", firstName: null, lastName: null, position: "Sales", email: `sales@${domain}`, type: "generic", seniority: null, department: "sales", confidence: 60, verification: "unknown" });

export const DEMO_COMPANIES: DemoCompany[] = [
  {
    domain: "northwind.io", name: "Northwind", kind: "strong", compliance: "in_progress", band: "51-200", hiring: "security_role",
    s: {
      product: "Northwind is a build and deploy platform for engineering teams.",
      funding: "We announced our Series B in September.",
      plan: "The Enterprise plan includes SSO and SAML for large organisations.",
      data: "Your source code and build logs stay in your account and we store them encrypted.",
      cert: "We are working toward our SOC 2 Type II report this year.",
      friction: "Request access to our security report.",
      size: "We are a team of 120 employees across three offices.",
      eu: "We serve customers across the EU.",
      logos: "Trusted by Globex and Initech.",
      hiring: "Open roles: Senior Security Engineer and Account Executive.",
    },
    contacts: [person("Ananya", "Rao", "CTO", "it", "executive", "northwind.io", 94), person("Dev", "Patel", "VP Engineering", "engineering", "senior", "northwind.io", 85), generic("northwind.io")],
  },
  {
    domain: "lumenhealth.com", name: "Lumen Health", kind: "strong", compliance: "in_progress", band: "11-50", hiring: "none",
    s: {
      product: "Lumen Health is scheduling software for independent clinics.",
      funding: "Lumen Health raised a seed round in March.",
      plan: "Our Enterprise tier adds SAML single sign-on and audit logs for clinic groups.",
      data: "Patient records and appointment history are stored in your Lumen account.",
      health: "We process patient health information on behalf of clinics.",
      cert: "Our SOC 2 audit is in progress and we expect our report next quarter.",
      friction: "Ask for our security questionnaire pack before you sign.",
      size: "Our team of 35 people is based in Pune and London.",
      eu: "Clinics in the UK and the EU use Lumen every day.",
      logos: "Used by clinic groups including Riverside Care and Oakfield Medical.",
      hiring: "Open roles: Customer Success Manager and Frontend Engineer.",
    },
    contacts: [person("Marcus", "Chen", "Head of Security", "security", "senior", "lumenhealth.com", 91), person("Priya", "Nair", "CEO", "executive", "executive", "lumenhealth.com", 88)],
  },
  {
    domain: "brightwave.ai", name: "Brightwave", kind: "strong", compliance: "in_progress", band: "51-200", hiring: "security_role",
    s: {
      product: "Brightwave is an analytics API that helps product teams measure feature adoption.",
      funding: "We launched Brightwave Enterprise this quarter.",
      plan: "Brightwave Enterprise includes SSO, SCIM provisioning and a dedicated region.",
      data: "Customer event data is stored in your dedicated Brightwave workspace.",
      cert: "We are preparing for SOC 2 and ISO 27001 with an audit planned for early next year.",
      friction: "Security reviews are handled through our request-access trust page.",
      size: "Brightwave has about 90 employees worldwide.",
      logos: "Trusted by Harbor Logistics and Kestrel Retail.",
      hiring: "Open roles: Head of Security and Staff Engineer.",
    },
    // Hunter holds only a sales mailbox for this one, so it ends with no usable contact.
    contacts: [generic("brightwave.ai")],
  },
  {
    domain: "harborpay.com", name: "Harbor Pay", kind: "strong", compliance: "soc2_type1", band: "51-200", hiring: "none",
    s: {
      product: "Harbor Pay is a payments platform for marketplaces.",
      plan: "Our Enterprise plan includes SSO and custom limits.",
      payments: "We process card payments for marketplaces in 30 countries.",
      cert: "Harbor Pay completed its SOC 2 Type I audit and is working toward Type II.",
      size: "Harbor Pay has about 150 employees.",
      logos: "Trusted by Orchard Market and Tern Goods.",
      data: "Payment records are stored in your Harbor Pay account.",
    },
    contacts: [person("Imran", "Qureshi", "CISO", "security", "executive", "harborpay.com", 90)],
  },
  {
    domain: "cobaltledger.io", name: "Cobalt Ledger", kind: "strong", compliance: "in_progress", band: "51-200", hiring: "security_role",
    s: {
      product: "Cobalt Ledger is a spend management platform for finance teams.",
      funding: "We raised our Series A in March.",
      plan: "The Enterprise plan adds SSO, SCIM and audit logs.",
      data: "Your invoices and bank connections are stored in your Cobalt Ledger workspace.",
      cert: "We are preparing for our first SOC 2 audit and have chosen an auditor.",
      friction: "Many customers send us a security questionnaire before they sign.",
      size: "Our team of 90 people works across Bengaluru and London.",
      eu: "We serve finance teams across the EU.",
      payments: "We process card payments on behalf of our customers.",
      logos: "Used by Fintrue and Lendwell.",
      hiring: "Open roles: Head of Security and Senior Backend Engineer.",
    },
    contacts: [person("Meera", "Iyer", "Head of Security", "security", "senior", "cobaltledger.io", 92), person("Rohan", "Shah", "CTO", "it", "executive", "cobaltledger.io", 86), generic("cobaltledger.io")],
  },
  { domain: "petalpop.app", name: "PetalPop", kind: "consumer", compliance: null, band: "11-50", hiring: null, s: { product: "PetalPop helps people keep their houseplants alive with daily reminders.", size: "We are a team of 20 plant lovers." }, contacts: [] },
  { domain: "quietcloud.dev", name: "QuietCloud", kind: "thin", compliance: null, band: null, hiring: null, s: { product: "QuietCloud." }, contacts: [] },
  { domain: "vanta.com", name: "Vanta", kind: "competitor", compliance: "soc2_iso", band: "201-500", hiring: "none", s: { product: "Vanta automates compliance for growing companies.", plan: "Enterprise customers get SSO and custom frameworks.", data: "Your evidence is stored in your Vanta account.", cert: "Vanta is SOC 2 Type II and ISO 27001 certified." }, contacts: [] },
];

/** The company the demo leaves waiting for approval, so the review desk has a real draft the moment it opens. */
export const UP_NEXT = "cobaltledger.io";

export const DEMO_BY_DOMAIN = new Map(DEMO_COMPANIES.map((c) => [c.domain, c]));
