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

const person = (first: string, last: string, position: string, dept: string, seniority: Candidate["seniority"], domain: string, confidence = 92, verification: Candidate["verification"] = "valid"): Candidate => ({
  source: "hunter", firstName: first, lastName: last, position, email: `${first.toLowerCase()}@${domain}`, type: "personal", seniority, department: dept, confidence, verification,
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
    // Hunter could only call this address "accept all", so the brief offers to check it properly (a paid check, shown in the demo).
    contacts: [person("Imran", "Qureshi", "CISO", "security", "executive", "harborpay.com", 90, "accept_all")],
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

/**
 * Companies the demo's Discover search can find that no sample run has read yet, so a person can pick some, research them
 * and watch the whole path. One is a hotel with a booking page, which Discover's look at the site drops.
 */
export const DEMO_DISCOVERABLE: DemoCompany[] = [
  {
    domain: "meridiancare.io", name: "Meridian Care", kind: "strong", compliance: "in_progress", band: "51-200", hiring: "security_role",
    s: {
      product: "Meridian Care is a patient messaging platform for hospital groups.",
      funding: "Meridian Care raised its Series B in June.",
      plan: "The Enterprise plan includes SAML single sign-on and audit logs.",
      data: "Patient messages and care plans are stored in your Meridian workspace.",
      health: "We process patient health information on behalf of hospital groups.",
      cert: "We are working toward our SOC 2 Type II report and expect it next year.",
      friction: "Hospital security teams send us a questionnaire before every pilot.",
      size: "Meridian Care has about 140 employees in Dublin and Boston.",
      eu: "Hospital groups across the EU use Meridian Care.",
      logos: "Trusted by Alder Health and Northgate Clinics.",
      hiring: "Open roles: GRC Manager and Senior Backend Engineer.",
    },
    contacts: [person("Sinead", "Walsh", "Head of Security", "security", "senior", "meridiancare.io", 93), person("Tom", "Reilly", "CTO", "it", "executive", "meridiancare.io", 87)],
  },
  {
    domain: "fathompay.com", name: "Fathom Pay", kind: "strong", compliance: "soc2_type1", band: "201-500", hiring: "none",
    s: {
      product: "Fathom Pay is a payments platform that lets software companies take card payments in 40 countries.",
      plan: "Our Enterprise plan includes SSO, custom limits and dedicated support.",
      payments: "We process card payments for software companies in 40 countries.",
      cert: "Fathom Pay completed its SOC 2 Type I audit and is working toward Type II.",
      size: "Fathom Pay has about 320 employees.",
      logos: "Trusted by Plover Software and Quill Cloud.",
      data: "Transaction records are stored in your Fathom account.",
    },
    contacts: [person("Lena", "Hoffmann", "CISO", "security", "executive", "fathompay.com", 91)],
  },
  {
    domain: "ledgerlight.io", name: "Ledgerlight", kind: "strong", compliance: "none_visible", band: "11-50", hiring: "none",
    s: {
      product: "Ledgerlight is a bookkeeping platform for accountants who serve small software companies.",
      funding: "Ledgerlight raised a seed round in April.",
      plan: "The Business plan adds SSO and audit logs for accounting firms.",
      data: "Client ledgers and invoices are stored in your Ledgerlight workspace.",
      friction: "Larger firms ask us for a security report before they onboard.",
      size: "Our team of 28 people works from Toronto and Lisbon.",
      eu: "Firms across the EU use Ledgerlight.",
      logos: "Used by Marlowe & Co and Teal Accounting.",
    },
    contacts: [person("Jonah", "Kerr", "CEO", "executive", "executive", "ledgerlight.io", 89), generic("ledgerlight.io")],
  },
  {
    domain: "tesseldata.com", name: "Tessel Data", kind: "strong", compliance: "in_progress", band: "51-200", hiring: "security_role",
    s: {
      product: "Tessel Data is a data pipeline platform that moves customer records between cloud tools.",
      funding: "We announced our Series A last autumn.",
      plan: "The Enterprise plan includes SSO, SCIM and a private region.",
      data: "Customer records are processed and stored in your Tessel workspace.",
      cert: "We are preparing for our first SOC 2 audit with an auditor chosen.",
      friction: "Enterprise buyers ask for our security documentation early in every deal.",
      size: "Tessel Data has about 75 employees.",
      eu: "We serve customers across the EU.",
      logos: "Trusted by Fernwood Retail and Skyline Freight.",
      hiring: "Open roles: Security Engineer and Solutions Architect.",
    },
    contacts: [person("Arjun", "Mehta", "VP Engineering", "engineering", "senior", "tesseldata.com", 90), person("Claire", "Dubois", "Head of Security", "security", "senior", "tesseldata.com", 92)],
  },
  { domain: "seaviewhotel.com", name: "Seaview Hotel", kind: "consumer", compliance: null, band: "11-50", hiring: null, s: { product: "Seaview Hotel is a family hotel and resort by the sea with a spa and a golf course.", size: "We are a team of 40 hosts." }, contacts: [] },
];

/** The company the demo leaves waiting for approval, so the review desk has a real draft the moment it opens. */
export const UP_NEXT = "cobaltledger.io";

export const DEMO_BY_DOMAIN = new Map([...DEMO_COMPANIES, ...DEMO_DISCOVERABLE].map((c) => [c.domain, c]));
