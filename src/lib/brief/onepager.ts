/**
 * The discovery brief as a one-page PDF a rep can take into the call, send or print. It is built from the same Brief the page shows,
 * so it can say nothing the page does not, and it always fits one A4 page: sections are added in order of usefulness and one that
 * does not fit is left out rather than spilling onto a second page. The PDF uses the standard fonts, which only cover Western
 * characters, so text from a company's site is cleaned to what they can draw. Pure layout is separate from drawing so both are tested.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { Brief } from "./build";

export const PAGE = { w: 595.28, h: 841.89, margin: 38 } as const;

const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-", "−": "-",
  "…": "...", " ": " ", "•": "-", "→": "->", "✓": "yes", "✕": "no", " ": " ", " ": " ", " ": " ", "​": "",
};

/** Text the standard PDF fonts can draw: common typography is mapped to plain characters, everything else outside Latin-1 is dropped. */
export function pdfSafe(input: string): string {
  let out = "";
  for (const ch of input) {
    if (ch in REPLACEMENTS) out += REPLACEMENTS[ch];
    else {
      const c = ch.codePointAt(0)!;
      if (c === 9 || c === 10 || c === 13) out += " ";
      else if (c >= 32 && c <= 126) out += ch;
      else if (c >= 161 && c <= 255) out += ch;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Cuts a sentence at a word boundary, with an ellipsis, so a long quote cannot take the whole page. */
export function clip(text: string, max: number): string {
  const t = pdfSafe(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:\s]+$/, "")}...`;
}

/** Breaks text into lines no wider than `width`, measured with the real font. A single word wider than a line is split. */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const words = pdfSafe(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    let w = word;
    while (measure(w) > width && w.length > 1) {
      // A word wider than the line: put as much as fits on this line and carry on with the rest.
      let k = w.length - 1;
      while (k > 1 && measure(w.slice(0, k)) > width) k -= 1;
      if (line) { lines.push(line); line = ""; }
      lines.push(w.slice(0, k));
      w = w.slice(k);
    }
    const next = line ? `${line} ${w}` : w;
    if (measure(next) <= width) line = next;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

export interface OnePagerPlan {
  /** The sections that made it onto the page, in order. */
  included: string[];
  /** The sections left out because the page was full. */
  omitted: string[];
}

const BRAND = rgb(0.396, 0.039, 0.255);
const INK = rgb(0.13, 0.12, 0.16);
const MUTED = rgb(0.43, 0.38, 0.41);
const LINE = rgb(0.86, 0.82, 0.8);
const GOOD = rgb(0.055, 0.42, 0.275);
const WARN = rgb(0.6, 0.32, 0.04);
const BAD = rgb(0.7, 0.15, 0.12);
const INFO = rgb(0.32, 0.21, 0.66);
const SOFT = rgb(0.973, 0.937, 0.922);

const STATUS_WORD: Record<string, string> = { held: "Held", in_progress: "In progress", likely: "Likely needed", not_indicated: "Not indicated" };
const STATUS_COLOR: Record<string, ReturnType<typeof rgb>> = { held: GOOD, in_progress: INFO, likely: WARN, not_indicated: MUTED };

/** Draws the one-pager and says which sections fit. */
export async function renderOnePager(b: Brief, when: Date = new Date()): Promise<{ bytes: Uint8Array; plan: OnePagerPlan }> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Discovery call one-pager: ${b.company.name}`));
  doc.setAuthor("Sprinto Outbound");
  doc.setCreator("Sprinto Outbound");
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);

  const left = PAGE.margin;
  const width = PAGE.w - PAGE.margin * 2;
  const floor = PAGE.margin + 22; // the footer lives below this
  let y = PAGE.h - PAGE.margin;
  const plan: OnePagerPlan = { included: [], omitted: [] };

  const lines = (text: string, size: number, font: PDFFont, w: number) => wrapText(text, w, (s) => font.widthOfTextAtSize(s, size));
  const text = (s: string, x: number, yy: number, size: number, font: PDFFont, color = INK) => page.drawText(pdfSafe(s), { x, y: yy, size, font, color });
  const para = (s: string, size = 10.2, font = reg, color = INK, indent = 0, lead = 1.32) => {
    for (const ln of lines(s, size, font, width - indent)) { text(ln, left + indent, y, size, font, color); y -= size * lead; }
  };
  const heightOf = (s: string, size = 10.2, font = reg, indent = 0, lead = 1.32) => lines(s, size, font, width - indent).length * size * lead;
  const heading = (s: string) => { y -= 4; text(s.toUpperCase(), left, y, 7.6, bold, BRAND); y -= 3; page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: 0.6, color: LINE }); y -= 10; };

  // A section is measured first, and drawn only if it fits above the footer, so the page can never overflow.
  const section = (name: string, need: number, draw: () => void) => {
    if (y - need < floor) { plan.omitted.push(name); return; }
    plan.included.push(name);
    draw();
    y -= 7;
  };

  // ---- header band: who, and how good a fit
  const headH = 78;
  page.drawRectangle({ x: 0, y: PAGE.h - headH, width: PAGE.w, height: headH, color: BRAND });
  text("DISCOVERY CALL ONE-PAGER", left, PAGE.h - 24, 7.6, bold, rgb(0.93, 0.98, 0.66));
  const name = clip(b.company.name, 44);
  text(name, left, PAGE.h - 49, 21, bold, rgb(1, 1, 1));
  text(`${b.company.domain}${b.company.size ? `  |  ${b.company.size} people` : ""}${b.company.certification ? `  |  ${clip(b.company.certification, 48)}` : ""}`, left, PAGE.h - 66, 8.6, reg, rgb(0.95, 0.88, 0.92));
  const score = b.fit.score === null ? "--" : String(b.fit.score);
  const sx = PAGE.w - PAGE.margin - 74;
  page.drawCircle({ x: sx + 24, y: PAGE.h - 38, size: 25, color: rgb(1, 1, 1) });
  const sw = bold.widthOfTextAtSize(score, 19);
  text(score, sx + 24 - sw / 2, PAGE.h - 44, 19, bold, BRAND);
  text(clip(b.fit.label, 20), sx + 52 - (reg.widthOfTextAtSize(clip(b.fit.label, 20), 8) / 2) - 22, PAGE.h - 72, 8, reg, rgb(1, 1, 1));
  y = PAGE.h - headH - 16;
  plan.included.push("header");

  // ---- where they stand
  const st = b.intel.stance;
  const standNeed = 24 + 17 + heightOf(`Lead with: ${st.angle}`) + heightOf(`Careful: ${st.caution}`, 9.4) + 64;
  section("Where they stand", standNeed, () => {
    heading("Where they stand");
    text(clip(st.headline, 70), left, y, 12.8, bold); y -= 17;
    para(`Lead with: ${st.angle}`);
    para(`Careful: ${st.caution}`, 9.4, ital, MUTED);
    y -= 3;
    const fw = b.intel.frameworks;
    const cw = (width - (fw.length - 1) * 5) / fw.length;
    fw.forEach((f, k) => {
      const x = left + k * (cw + 5);
      page.drawRectangle({ x, y: y - 36, width: cw, height: 40, color: SOFT, borderColor: LINE, borderWidth: 0.5 });
      page.drawRectangle({ x, y: y - 36, width: 3.5, height: 40, color: STATUS_COLOR[f.status] ?? MUTED });
      text(f.name, x + 9, y - 9, 9.6, bold);
      text(STATUS_WORD[f.status] ?? f.status, x + 9, y - 22, 8.4, bold, STATUS_COLOR[f.status] ?? MUTED);
      text(f.status === "not_indicated" ? "" : f.basis === "stated" ? "stated on their site" : "our inference", x + 9, y - 32, 7, reg, MUTED);
    });
    y -= 42;
    const warnings = fw.filter((f) => f.status !== "not_indicated" && !f.sprintoClaim).map((f) => f.name);
    if (warnings.length) { y -= 2; para(`Do not promise anything about ${warnings.join(", ")}: no verified Sprinto claim covers it.`, 8.6, ital, BAD); }
  });

  // ---- who to speak to
  const people = [b.contact ? { name: b.contact.name, title: b.contact.title, extra: b.contact.email ?? "" , lead: true } : null, ...b.group.slice(0, 2).map((m) => ({ name: m.name, title: m.title, extra: m.angle ? `Lead with: ${m.angle.label}` : (m.roleLabel ?? ""), lead: false }))].filter((p): p is { name: string; title: string | null; extra: string; lead: boolean } => p !== null);
  if (people.length) {
    const trust = b.contact?.trust ? clip(`${b.contact.trust}.`, 140) : "";
    section("Who to speak to", 26 + people.length * 29 + (trust ? 12 : 0), () => {
      heading("Who to speak to");
      for (const p of people) {
        text(`${clip(p.name, 34)}${p.lead ? "  (the email goes here)" : ""}`, left, y, 10.8, bold, p.lead ? BRAND : INK);
        text(clip(`${p.title ?? "Title not listed"}${p.extra ? `  |  ${p.extra}` : ""}`, 100), left, y - 12.4, 9.2, reg, MUTED);
        y -= 29;
        // How far to trust the address belongs under the person it is about.
        if (p.lead && trust) { y += 4; text(trust, left, y, 8.6, ital, MUTED); y -= 12; }
      }
    });
  }

  // ---- why now
  const now = b.whyNow.slice(0, 2);
  if (now.length) {
    const need = 26 + now.reduce((n, w) => n + 14 + (w.quote ? heightOf(`"${clip(w.quote, 150)}"`, 9.2, ital, 10) : 0), 0);
    section("Why now", need, () => {
      heading("Why now");
      for (const w of now) {
        text(clip(w.text, 100), left, y, 10, bold); y -= 14;
        if (w.quote) para(`"${clip(w.quote, 150)}"`, 9.2, ital, MUTED, 10);
      }
    });
  }

  // ---- call plan
  const pl = b.intel.plan;
  const steps = pl.steps.slice(0, 4);
  const planNeed = 26 + (pl.opener ? heightOf(clip(pl.opener.line, 170), 9.6, ital) : 0) + steps.reduce((n, s) => n + heightOf(`${s.title}: ${s.ask}`, 9.6, reg, 15), 0) + heightOf(`Ask: ${pl.nextStep}`, 9.4) + 10;
  section("Call plan", planNeed, () => {
    heading("Call plan");
    if (pl.opener) para(clip(pl.opener.line, 170), 9.6, ital, MUTED);
    steps.forEach((s, k) => {
      text(`${k + 1}.`, left, y, 9.6, bold, BRAND);
      for (const ln of lines(`${s.title}: ${s.ask}`, 9.6, reg, width - 15)) { text(ln, left + 15, y, 9.6, reg); y -= 9.6 * 1.32; }
    });
    para(`Ask: ${pl.nextStep}`, 9.4, bold, INK);
  });

  // ---- likely objections
  const obj = b.objections.slice(0, 2);
  if (obj.length) {
    const need = 26 + obj.reduce((n, o) => n + 13 + heightOf(clip(o.response, 190), 9, reg, 10), 0);
    section("Likely objections", need, () => {
      heading("Likely objections");
      for (const o of obj) {
        text(`"${clip(o.says, 92)}"`, left, y, 9.8, bold); y -= 13;
        para(clip(o.response, 190), 9, reg, MUTED, 10);
      }
    });
  }

  // ---- bring
  const bring = pl.bring.slice(0, 2);
  const bringNeed = 26 + bring.reduce((n, x) => n + heightOf(`- ${clip(x, 150)}`, 9.2), 0);
  section("What to bring", bringNeed, () => {
    heading("What to bring");
    for (const x of bring) para(`- ${clip(x, 150)}`, 9.2);
  });

  // ---- footer on every page: how much to trust it, and where it came from
  const foot = `Built from ${b.company.domain}'s own pages, nothing guessed. Evidence ${b.intel.confidence.percent}% (${b.intel.confidence.label}). Prepared ${when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} by Sprinto Outbound.`;
  page.drawLine({ start: { x: left, y: PAGE.margin + 12 }, end: { x: left + width, y: PAGE.margin + 12 }, thickness: 0.5, color: LINE });
  text(clip(foot, 150), left, PAGE.margin, 7, reg, MUTED);

  return { bytes: await doc.save(), plan };
}

/** A filename safe for a download header: the domain, plain characters only. */
export const onePagerFilename = (domain: string) => `${domain.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "company"}-call-one-pager.pdf`;

