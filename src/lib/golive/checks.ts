/**
 * Go-live readiness. Not a switch: the sender is built so it cannot take a recipient, so leaving test mode is a reviewed code
 * change, not a setting. What this page does is tell the truth about whether everything around that change is ready: the
 * sending domain's mail authentication (SPF, DKIM, DMARC), the sender's details, the safeguards that are already built in, and
 * a sensible daily ramp. Each check is "pass", "warn" (works, but a risk) or "fail" (fix before going live), with what to do.
 * The evaluators are pure and take the DNS answers as arguments, so each rule is tested without a network.
 */

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to do, when it is not a pass. */
  fix?: string;
}

const txt = (records: string[][]) => records.map((r) => r.join("")).filter((s) => s !== "");

export const senderDomain = (address: string | null | undefined): string | null => {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.exec((address ?? "").trim());
  return m ? m[1]!.toLowerCase() : null;
};

const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);

export function checkSenderDomain(from: string | null): Check {
  const d = senderDomain(from);
  if (!d) return { id: "sender", label: "A sending address on your own domain", status: "fail", detail: "No sending address is set, so there is no domain to check.", fix: "Connect Gmail with the address mail should come from." };
  if (PERSONAL.has(d)) {
    return { id: "sender", label: "A sending address on your own domain", status: "fail", detail: `Mail would come from a personal ${d} address. A personal account cannot carry your own SPF, DKIM and DMARC, and large volumes from it are likely to be blocked.`, fix: "Send from an address on a domain you control, for example through Google Workspace." };
  }
  return { id: "sender", label: "A sending address on your own domain", status: "pass", detail: `Mail comes from ${d}.` };
}

export function evalSpf(records: string[][], domain: string): Check {
  const spf = txt(records).filter((r) => /^v=spf1(\s|$)/i.test(r));
  const label = "SPF: which servers may send for the domain";
  if (spf.length === 0) return { id: "spf", label, status: "fail", detail: `${domain} has no SPF record, so receivers cannot tell your mail from a forgery.`, fix: `Add a TXT record on ${domain} such as "v=spf1 include:_spf.google.com ~all" (for Google Workspace).` };
  if (spf.length > 1) return { id: "spf", label, status: "fail", detail: `${domain} has ${spf.length} SPF records. More than one invalidates all of them.`, fix: "Merge them into one record." };
  const r = spf[0]!;
  const all = /\s([-~?+]?)all\s*$/i.exec(r)?.[1];
  if (!/include:|ip4:|ip6:|\sa(\s|$)|\smx(\s|$)/i.test(r)) return { id: "spf", label, status: "warn", detail: "An SPF record exists but names no sending service.", fix: "Add the include for the service that sends your mail (Google Workspace: include:_spf.google.com)." };
  if (all === "-") return { id: "spf", label, status: "pass", detail: "SPF is set and rejects anything not listed (-all)." };
  if (all === "~") return { id: "spf", label, status: "pass", detail: "SPF is set; mail from other servers is marked suspicious (~all), which is the usual setting." };
  return { id: "spf", label, status: "warn", detail: "SPF is set but does not say what to do with other servers (it ends without -all or ~all, or with ?all).", fix: "End the record with ~all, or -all once you are sure every sender is listed." };
}

export function evalDmarc(records: string[][], domain: string): Check {
  const label = "DMARC: what receivers do with mail that fails the checks";
  const d = txt(records).filter((r) => /^v=DMARC1\b/i.test(r));
  if (d.length === 0) return { id: "dmarc", label, status: "fail", detail: `_dmarc.${domain} has no DMARC record. Gmail and Yahoo now expect one from anyone sending in volume.`, fix: `Add a TXT record on _dmarc.${domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}" to start, then tighten it.` };
  const policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(d[0]!)?.[1]?.toLowerCase();
  if (!policy) return { id: "dmarc", label, status: "fail", detail: "A DMARC record exists but has no valid policy (p=).", fix: "Add p=none, p=quarantine or p=reject." };
  if (policy === "none") return { id: "dmarc", label, status: "warn", detail: "DMARC is in monitoring mode (p=none): it reports problems but does not stop forged mail.", fix: "Once reports look clean, move to p=quarantine, then p=reject." };
  const pct = Number(/(?:^|;)\s*pct\s*=\s*(\d+)/i.exec(d[0]!)?.[1] ?? 100);
  return pct < 100 ? { id: "dmarc", label, status: "warn", detail: `DMARC policy is ${policy}, but applies to only ${pct}% of mail.`, fix: "Raise pct to 100 when ready." } : { id: "dmarc", label, status: "pass", detail: `DMARC policy is ${policy}.` };
}

export function evalDkim(records: string[][], domain: string, selector: string): Check {
  const label = "DKIM: a signature that proves the mail was not altered";
  const k = txt(records).filter((r) => /v=DKIM1|\bp=/i.test(r));
  if (k.length > 0 && /\bp=[A-Za-z0-9+/=]{10,}/.test(k.join(""))) return { id: "dkim", label, status: "pass", detail: `A DKIM key is published at ${selector}._domainkey.${domain}.` };
  return { id: "dkim", label, status: "warn", detail: `No DKIM key was found at ${selector}._domainkey.${domain}. If your mail provider uses a different selector this may be a false alarm.`, fix: "In Google Workspace, turn on DKIM signing for the domain (Admin console, Gmail, Authenticate email), or check the selector with your provider." };
}

export function evalMx(records: { exchange: string }[], domain: string): Check {
  return records.length > 0
    ? { id: "mx", label: "The domain can receive replies", status: "pass", detail: `${domain} has ${records.length} mail ${records.length === 1 ? "server" : "servers"}, so replies and bounces have somewhere to go.` }
    : { id: "mx", label: "The domain can receive replies", status: "fail", detail: `${domain} has no MX record, so replies and bounces would be lost.`, fix: "Add the MX records your mail provider gives you." };
}

/** A postal address a recipient could actually find: enough words, a number, and a place. "600020" alone is not one. */
export function looksLikeFullAddress(s: string | null | undefined): boolean {
  const t = (s ?? "").trim();
  if (t.length < 15 || /\[|\bTODO\b|PLACEHOLDER/i.test(t)) return false;
  const words = t.split(/[\s,]+/).filter(Boolean);
  return words.length >= 4 && /\d/.test(t) && /[A-Za-z]{3,}/.test(t) && (t.includes(",") || words.length >= 5);
}

/**
 * How many emails a day is sensible for a sender that is new to sending, by how long it has been sending. A new or lightly used
 * domain that suddenly sends in volume looks like spam to receivers; a steady climb builds a reputation.
 */
export function recommendedDailyCap(firstSendAt: string | Date | null, now: number): number {
  if (!firstSendAt) return 10;
  const days = Math.floor((now - new Date(firstSendAt).getTime()) / 86_400_000);
  return days < 7 ? 10 : days < 14 ? 25 : days < 21 ? 50 : days < 35 ? 100 : 200;
}

export interface SetupFacts {
  testTo: string | null;
  fromAddress: string | null;
  postalAddress: string | null;
  senderName: string | null;
  senderTitle: string | null;
  verifiedClaims: number;
  icpSigned: boolean;
  approvalRequired: boolean;
  dailyCap: number | null;
  cooldownDays: number;
  firstSendAt: string | null;
  suppressions: number;
  outcomesRecorded: number;
  gmailConnected: boolean;
  workerRecent: boolean;
  now: number;
}

const placeholder = (s: string | null | undefined) => !s || /^\s*$|\[|\bTODO\b|PLACEHOLDER/i.test(s);

/** The checks that depend on how the product is set up, not on DNS. */
export function setupChecks(f: SetupFacts): Check[] {
  const rec = recommendedDailyCap(f.firstSendAt, f.now);
  return [
    { id: "address", label: "A full postal address in every email", status: looksLikeFullAddress(f.postalAddress) ? "pass" : "fail", detail: looksLikeFullAddress(f.postalAddress) ? "The opt-out footer carries a full postal address." : `The address on file is “${(f.postalAddress ?? "").trim() || "empty"}”, which is not a full postal address. Anti-spam law in many countries requires one.`, fix: "Enter the full postal address in Settings." },
    { id: "sender-name", label: "A real sender name and title", status: placeholder(f.senderName) || placeholder(f.senderTitle) ? "fail" : "pass", detail: placeholder(f.senderName) || placeholder(f.senderTitle) ? "The sender's name or title is not set." : `Emails are signed ${f.senderName}, ${f.senderTitle}.`, fix: "Set the sender in Settings." },
    { id: "claims", label: "Claims about Sprinto checked by a person", status: f.verifiedClaims > 0 ? "pass" : "fail", detail: f.verifiedClaims > 0 ? `${f.verifiedClaims} ${f.verifiedClaims === 1 ? "claim has" : "claims have"} been verified against a source.` : "No claim about Sprinto has been verified, so a draft has nothing it may say.", fix: "Verify claims in Settings." },
    { id: "icp", label: "An ICP that a person signed off", status: f.icpSigned ? "pass" : "fail", detail: f.icpSigned ? "A signed-off ICP version is in use." : "No ICP version has been signed off.", fix: "Sign it off on the ICP page." },
    { id: "gmail", label: "Gmail connected", status: f.gmailConnected ? "pass" : "fail", detail: f.gmailConnected ? "The sender can send." : "Gmail is not connected.", fix: "Run npm run gmail-token and set the three Gmail values." },
    { id: "worker", label: "The scheduled worker is running", status: f.workerRecent ? "pass" : "warn", detail: f.workerRecent ? "The worker has run in the last hour." : "The worker has not run in the last hour, so approved emails and the weekly digest may wait.", fix: "Check the Worker workflow on GitHub." },
    { id: "approval", label: "A person approves every email", status: f.approvalRequired ? "pass" : "warn", detail: f.approvalRequired ? "Approval is required before anything is sent." : "Approval is switched off, so drafts are sent without a person reading them.", fix: "Turn approval back on in Settings." },
    { id: "ramp", label: "A daily cap that suits a new sender", status: f.dailyCap === null ? "warn" : f.dailyCap <= rec ? "pass" : "warn", detail: f.dailyCap === null ? "No daily cap is set." : f.dailyCap <= rec ? `The cap of ${f.dailyCap} a day is within what is sensible for a sender ${f.firstSendAt ? "of this age" : "that has not started yet"} (up to ${rec}).` : `The cap is ${f.dailyCap} a day. For a sender ${f.firstSendAt ? "this young" : "that has not started yet"}, about ${rec} is safer, rising each week.`, fix: `Set the daily cap to ${rec} for now and raise it as the weeks pass.` },
  ];
}

/** Safeguards that are built into the product and enforced in the database or the sender, listed so a reviewer can see them. */
export function builtInSafeguards(f: Pick<SetupFacts, "testTo" | "cooldownDays" | "suppressions" | "outcomesRecorded">): { label: string; detail: string }[] {
  return [
    { label: "The recipient cannot be chosen by a draft", detail: f.testTo ? `The sender takes no recipient. In test mode every email goes to ${f.testTo} only.` : "The sender takes no recipient; test mode has no address set, so nothing can be sent." },
    { label: "One email per company", detail: `A company mailed in the last ${f.cooldownDays} days is skipped, enforced in the database.` },
    { label: "A daily send cap, enforced in the database", detail: "The cap is checked when a send is reserved, so no screen and no script can exceed it." },
    { label: "A do-not-contact list that is checked before every send", detail: `${f.suppressions} ${f.suppressions === 1 ? "entry is" : "entries are"} on the list. Marking a lead “not interested” can add its company in one step.` },
    { label: "An opt-out line and a postal address in every email", detail: "Twelve checks run on every draft, including that the opt-out line and the postal address are present." },
    { label: "A one-click unsubscribe header", detail: "Every message carries a List-Unsubscribe header, so mail clients can show an Unsubscribe link." },
    { label: "A permanent record of who approved what", detail: "Each approval, with how much the person edited, is an append-only row." },
    { label: "Replies that say no are easy to honour", detail: f.outcomesRecorded ? `${f.outcomesRecorded} ${f.outcomesRecorded === 1 ? "outcome has" : "outcomes have"} been recorded.` : "Record a “not interested” on the Leads page and tick “never contact this company again”." },
  ];
}

export interface Verdict {
  fails: number;
  warns: number;
  ready: boolean;
  headline: string;
}

export function verdictOf(checks: Check[]): Verdict {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  return {
    fails,
    warns,
    ready: fails === 0,
    headline: fails > 0 ? `${fails} ${fails === 1 ? "thing" : "things"} to fix before going live` : warns > 0 ? `Ready, with ${warns} ${warns === 1 ? "thing" : "things"} worth a look` : "Everything checked is in place",
  };
}
