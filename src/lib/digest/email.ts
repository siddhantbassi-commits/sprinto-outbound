/**
 * The weekly digest as an email to the owner: a short formal note listing the new companies, each with what its own site says
 * and why it was suggested, and a link to the digest page where they can be researched. Plain text and HTML say the same
 * thing. Everything shown is escaped and nothing is loaded from elsewhere. It goes only to the owner's own address, and the
 * message says so, because it is the one email this product sends that is not about a prospect.
 */

export interface DigestCompany {
  domain: string;
  name: string;
  /** What the site says about itself, in its own words. May be empty. */
  about: string;
  /** Why it was suggested, one line per reason. */
  because: string[];
  emailsTotal: number;
  /** The size band Hunter found it under, when known. Carried into the run so size is not unknown for a site that never states it. */
  band?: string | null;
}

export interface DigestEmailInput {
  companies: DigestCompany[];
  /** How many Hunter matches there were before cleaning and before removing ones already shown. */
  considered: number;
  /** Where the digest page lives, for the link. Null leaves the link out. */
  appUrl: string | null;
  /** The date shown in the heading, already formatted. */
  weekOf: string;
}

const MAX_LISTED = 12;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const one = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const plural = (n: number) => `${n} new ${n === 1 ? "company" : "companies"}`;

export const digestSubject = (n: number) => `Weekly discovery digest: ${plural(n)} to consider`;

const link = (appUrl: string | null) => (appUrl ? `${appUrl.replace(/\/+$/, "")}/digest` : null);

export function digestText(i: DigestEmailInput): string {
  const shown = i.companies.slice(0, MAX_LISTED);
  const url = link(i.appUrl);
  const lines = [
    "Good morning,",
    "",
    `This week's search found ${plural(i.companies.length)} that look like Sprinto customers and that have not been shown to you before (week of ${i.weekOf}).`,
    "",
    ...shown.flatMap((c, n) => [
      `${n + 1}. ${one(c.name, 80)} (${one(c.domain, 80)})`,
      ...(c.about ? [`   ${one(c.about, 220)}`] : []),
      ...(c.because.length ? [`   Why: ${c.because.map((b) => one(b, 120)).join("; ")}.`] : []),
      "",
    ]),
  ];
  if (i.companies.length > shown.length) lines.push(`And ${i.companies.length - shown.length} more on the digest page.`, "");
  lines.push(url ? `Choose which to research: ${url}` : "Open the Weekly digest page in Sprinto Outbound to choose which to research.", "");
  lines.push("Nothing has been researched or sent. A match is only a lead: whether a company fits is decided after its own site is read and scored.", "", "This message went to you only. No company on this list was contacted.");
  return lines.join("\n");
}

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#211f28";
const PLUM = "#650a41";
const MUTED = "#6e6269";
const RULE = "#eadfd9";

export function digestHtml(i: DigestEmailInput): string {
  const shown = i.companies.slice(0, MAX_LISTED);
  const url = link(i.appUrl);
  const items = shown.map((c, n) => `<tr><td style="padding:14px 0;border-top:1px solid ${RULE};">
<div style="font:600 16px ${SERIF};color:${INK};">${n + 1}. ${esc(one(c.name, 80))} <span style="font:12px ${SANS};color:${MUTED};">${esc(one(c.domain, 80))}</span></div>
${c.about ? `<div style="margin-top:4px;font:italic 14px/1.5 ${SERIF};color:#3f3a42;">${esc(one(c.about, 220))}</div>` : ""}
${c.because.length ? `<div style="margin-top:6px;font:12px/1.5 ${SANS};color:${MUTED};">${c.because.map((b) => esc(one(b, 120))).join(" &middot; ")}</div>` : ""}
</td></tr>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(digestSubject(i.companies.length))}</title></head>
<body style="margin:0;padding:0;background:#f6f1ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ee;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid ${RULE};border-radius:6px;overflow:hidden;">
<tr><td style="height:4px;line-height:4px;font-size:0;background:${PLUM};">&nbsp;</td></tr>
<tr><td style="padding:32px 44px 8px;font:16px/1.7 ${SERIF};color:${INK};">
<p style="margin:0 0 6px;font:700 11px ${SANS};letter-spacing:.14em;color:${PLUM};">WEEKLY DISCOVERY DIGEST &middot; WEEK OF ${esc(one(i.weekOf, 40).toUpperCase())}</p>
<p style="margin:14px 0 14px;">Good morning,</p>
<p style="margin:0 0 6px;">This week's search found <strong>${esc(plural(i.companies.length))}</strong> that look like Sprinto customers and that have not been shown to you before.</p>
</td></tr>
<tr><td style="padding:0 44px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${items}
</table></td></tr>
<tr><td style="padding:18px 44px 8px;font:16px/1.7 ${SERIF};color:${INK};">
${i.companies.length > shown.length ? `<p style="margin:0 0 14px;">And ${i.companies.length - shown.length} more on the digest page.</p>` : ""}
${url ? `<p style="margin:0 0 18px;"><a href="${esc(url)}" style="display:inline-block;background:${PLUM};color:#ffffff;text-decoration:none;font:600 14px ${SANS};padding:11px 22px;border-radius:999px;">Choose which to research</a></p>` : ""}
<p style="margin:0;font:13px/1.6 ${SANS};color:${MUTED};">Nothing has been researched or sent. A match is only a lead: whether a company fits is decided after its own site is read and scored.</p>
</td></tr>
<tr><td style="padding:18px 44px 26px;font:12px/1.6 ${SANS};color:${MUTED};"><span style="font-weight:700;letter-spacing:.14em;color:${PLUM};">SPRINTO</span><br>This message went to you only. No company on this list was contacted.</td></tr>
</table></td></tr></table></body></html>`;
}
