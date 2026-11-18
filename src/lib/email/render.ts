/**
 * The formal email, as it looks in an inbox. The text a person approves is the single source: this reads its parts (greeting,
 * paragraphs, sign-off, opt-out line) and lays them out as a letter, so an edit made at review is exactly what is rendered.
 * Everything is escaped, nothing is loaded from elsewhere (no images, no tracking, no remote fonts), and the plain-text
 * alternative is the same words, so a client that blocks HTML still shows the same email.
 */

import type { HeaderInput } from "./inbox-header";

export interface Letter {
  greeting: string | null;
  paragraphs: string[][];
  signoff: { closing: string; lines: string[] } | null;
  footer: string | null;
}

const CLOSING = /^(kind regards|best regards|warm regards|regards|sincerely|best wishes|best|thanks|thank you),?$/i;
const GREETING = /^(dear|hi|hello)\b[^\n]*,$/i;
const OPT_OUT = /reply\s+["'“]?no["'”]?/i;

/** Splits an email body into the parts a letter has. Anything it does not recognise stays as an ordinary paragraph. */
export function parseLetter(body: string): Letter {
  const blocks = body.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length > 0);
  let greeting: string | null = null;
  let footer: string | null = null;
  let signoff: Letter["signoff"] = null;
  if (blocks[0]?.length === 1 && GREETING.test(blocks[0][0]!)) greeting = blocks.shift()![0]!;
  const last = blocks.at(-1);
  if (last && OPT_OUT.test(last.join(" "))) footer = (blocks.pop() as string[]).join(" ");
  const sign = blocks.at(-1);
  if (sign && CLOSING.test(sign[0]!)) {
    blocks.pop();
    signoff = { closing: sign[0]!.replace(/,?$/, ","), lines: sign.slice(1) };
  }
  return { greeting, paragraphs: blocks, signoff, footer };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const line = (s: string | null | undefined, max = 200) => (s ?? "").replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#211f28";
const PLUM = "#650a41";
const MUTED = "#6e6269";
const RULE_COLOUR = "#eadfd9";

export interface RenderOptions {
  subject: string;
  body: string;
  /** Test mode only: a small notice under the email saying where it would have gone and why. Never shown to a real recipient. */
  notice?: HeaderInput & { briefUrl: string | null };
}

function noticeHtml(n: NonNullable<RenderOptions["notice"]>): string {
  const who = [line(n.contactName, 80), line(n.contactTitle, 80) && `${line(n.contactTitle, 80)} at ${line(n.company, 80)}`].filter(Boolean).join(", ");
  const proof = [n.emailVerification && `email ${line(n.emailVerification, 30)}`, n.emailConfidence !== null && `confidence ${Math.round(n.emailConfidence)}`].filter(Boolean).join(", ");
  const rows: [string, string][] = [
    ["Intended for", `${esc(who)}${n.contactEmail ? ` &lt;${esc(line(n.contactEmail, 120))}&gt;` : ""}${proof ? ` (${esc(proof)})` : ""}`],
    ["Fit", `${esc(line(n.verdict, 20))} ${Math.round(n.score)}/100${n.reasons.length ? `. ${n.reasons.slice(0, 3).map((r) => esc(line(r.label, 80))).join("; ")}` : ""}`],
    ["Pains", n.pains.length ? n.pains.map((p) => esc(line(p.label, 80))).join("; ") : "none recorded"],
    ["Opens with", esc(line(n.hookSource, 200)) || "none recorded"],
  ];
  const tr = rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;font:600 11px ${SANS};color:${MUTED};white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:2px 0;font:12px/1.5 ${SANS};color:${INK};">${v}</td></tr>`).join("");
  const link = n.briefUrl ? `<p style="margin:10px 0 0;font:12px ${SANS};"><a href="${esc(line(n.briefUrl, 300))}" style="color:${PLUM};">Open the discovery brief</a></p>` : "";
  return `<tr><td style="padding:18px 8px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed #d9c9c1;border-radius:8px;background:#fffaf6;"><tr><td style="padding:14px 18px;">
<p style="margin:0 0 8px;font:700 10px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${PLUM};">Test delivery</p>
<p style="margin:0 0 8px;font:12px/1.5 ${SANS};color:${INK};">This message was sent to you only. It was not sent to the contact.</p>
<table role="presentation" cellpadding="0" cellspacing="0">${tr}</table>${link}
</td></tr></table></td></tr>`;
}

/** A self-contained HTML email: inline styles, tables, system fonts, no images and no scripts. */
export function renderEmailHtml(o: RenderOptions): string {
  const l = parseLetter(o.body);
  const pre = esc(line(l.paragraphs[0]?.join(" ") ?? "", 110));
  const p = (lines: string[]) => `<p style="margin:0 0 18px;">${lines.map(esc).join("<br>")}</p>`;
  const sig = l.signoff
    ? `<p style="margin:26px 0 0;">${esc(l.signoff.closing)}</p><p style="margin:14px 0 0;line-height:1.5;">${l.signoff.lines.map((x, i) => (i === 0 ? `<strong style="font-size:17px;">${esc(x)}</strong>` : i === 1 ? `<span style="color:${MUTED};">${esc(x)}</span>` : esc(x))).join("<br>")}</p>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(line(o.subject, 120))}</title></head>
<body style="margin:0;padding:0;background:#f6f1ee;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${pre}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ee;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;"><tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${RULE_COLOUR};border-radius:6px;overflow:hidden;">
<tr><td style="height:4px;line-height:4px;font-size:0;background:${PLUM};">&nbsp;</td></tr>
<tr><td style="padding:34px 44px 6px;font:16px/1.7 ${SERIF};color:${INK};">
${l.greeting ? `<p style="margin:0 0 20px;">${esc(l.greeting)}</p>` : ""}
${l.paragraphs.map(p).join("\n")}
${sig}
</td></tr>
<tr><td style="padding:26px 44px 0;"><div style="border-top:1px solid ${RULE_COLOUR};line-height:1px;height:1px;font-size:0;">&nbsp;</div></td></tr>
<tr><td style="padding:14px 44px 28px;font:12px/1.6 ${SANS};color:${MUTED};">
<span style="font-weight:700;letter-spacing:.14em;color:${PLUM};">SPRINTO</span>${l.footer ? `<br>${esc(l.footer)}` : ""}
</td></tr>
</table></td></tr>
${o.notice ? noticeHtml(o.notice) : ""}
</table></td></tr></table></body></html>`;
}
