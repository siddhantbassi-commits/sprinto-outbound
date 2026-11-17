/**
 * Turns a page's HTML into the text Gemini reads and the grounding check searches, plus the page's own links.
 * No browser and no parser dependency: one pass over the tags. It keeps what carries evidence (headings, body text, image
 * alt text such as "SOC 2 Type II" badges, meta tags, JSON-LD) and drops what does not (scripts, styles, nav chrome).
 */

export interface PageLink {
  href: string;
  text: string;
}

export interface ExtractedPage {
  title: string;
  text: string;
  links: PageLink[];
  /** Too little text to judge from; usually a page that only renders in JavaScript. */
  thin: boolean;
}

export const THIN_CHARS = 400;
const MAX_TEXT_CHARS = 120_000;
const MAX_LINKS = 300;

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Their content never reaches the text. Raw-text elements are skipped by jumping to their closing tag. */
const RAW_SKIP = new Set(["script", "style"]);
const DEPTH_SKIP = new Set(["noscript", "template", "svg", "nav", "iframe", "object", "canvas", "select"]);
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
  "br", "hr", "tr", "table", "form", "blockquote", "pre", "dt", "dd", "dl", "figure", "figcaption", "details", "summary", "body", "title",
]);
const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "source", "area", "base", "col", "embed", "wbr"]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', copy: "(c)", reg: "(r)", trade: "(tm)", middot: "·", bull: "•", laquo: "«", raquo: "»", euro: "EUR", pound: "GBP",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name || name in out) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Keeps the readable strings of a JSON-LD block (names, descriptions, job titles), not its URLs or ids. */
function jsonLdStrings(raw: string): string[] {
  const out: string[] = [];
  const KEYS = new Set(["name", "description", "slogan", "headline", "jobtitle", "title", "numberofemployees", "foundingdate", "legalname", "alternatename"]);
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 6 || out.length > 40) return;
    if (typeof v === "string") {
      if (KEYS.has(key) && v.length >= 3 && v.length <= 400 && !/^https?:/i.test(v)) out.push(clean(v));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key, depth + 1));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k.toLowerCase(), depth + 1);
    else if (typeof v === "number" && key === "numberofemployees") out.push(String(v));
  };
  try {
    walk(JSON.parse(raw), "", 0);
  } catch {
    /* malformed JSON-LD is common; ignore it */
  }
  return out;
}

function resolveLink(href: string, base: URL): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(mailto|tel|javascript|data|sms):/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

export function htmlToText(html: string, baseUrl: string): ExtractedPage {
  const base = new URL(baseUrl);
  const src = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");
  const lines: string[] = [];
  const metaLines: string[] = [];
  const links: PageLink[] = [];
  const seenLinks = new Set<string>();
  let title = "";
  let buf = "";
  let skipName: string | null = null;
  let skipDepth = 0;
  let inTitle = false;
  let openLink: { href: string; text: string } | null = null;

  const flush = () => {
    const t = clean(decodeEntities(buf));
    buf = "";
    if (t) lines.push(t);
  };
  const closeLink = () => {
    if (!openLink) return;
    const text = clean(decodeEntities(openLink.text));
    if (!seenLinks.has(openLink.href) && links.length < MAX_LINKS) {
      seenLinks.add(openLink.href);
      links.push({ href: openLink.href, text: text.slice(0, 120) });
    }
    openLink = null;
  };
  const addText = (raw: string) => {
    if (skipName) return;
    buf += raw;
    if (inTitle) title += raw;
    if (openLink) openLink.text += raw;
  };

  let last = 0;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(src)) !== null) {
    const closing = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    const rawAttrs = m[3] ?? "";
    addText(src.slice(last, m.index));
    last = TAG.lastIndex;

    if (skipName) {
      if (name === skipName) {
        if (closing) {
          skipDepth -= 1;
          if (skipDepth === 0) skipName = null;
        } else if (!rawAttrs.trimEnd().endsWith("/")) skipDepth += 1;
      }
      continue;
    }

    if (!closing && RAW_SKIP.has(name)) {
      const end = src.toLowerCase().indexOf(`</${name}`, last);
      const inner = src.slice(last, end === -1 ? src.length : end);
      if (name === "script" && /ld\+json/i.test(attributes(rawAttrs).type ?? "")) metaLines.push(...jsonLdStrings(inner));
      const close = end === -1 ? -1 : src.indexOf(">", end);
      last = close === -1 ? src.length : close + 1;
      TAG.lastIndex = last;
      continue;
    }
    if (DEPTH_SKIP.has(name) && !closing) {
      if (name === "nav") {
        // The text of navigation is chrome, but its links are how we find the pricing and security pages.
        const end = src.toLowerCase().indexOf("</nav", last);
        for (const a of src.slice(last, end === -1 ? src.length : end).matchAll(/<a\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/a>/gi)) {
          const href = resolveLink(attributes(a[1] ?? "").href ?? "", base);
          if (href && !seenLinks.has(href) && links.length < MAX_LINKS) {
            seenLinks.add(href);
            links.push({ href, text: clean(decodeEntities((a[2] ?? "").replace(/<[^>]*>/g, " "))).slice(0, 120) });
          }
        }
      }
      if (!rawAttrs.trimEnd().endsWith("/")) {
        skipName = name;
        skipDepth = 1;
      }
      continue;
    }

    if (name === "title") {
      if (closing) inTitle = false;
      else {
        flush();
        inTitle = true;
      }
      continue;
    }

    if (name === "meta" && !closing) {
      const a = attributes(rawAttrs);
      const key = (a.name ?? a.property ?? "").toLowerCase();
      if (["description", "og:title", "og:description", "og:site_name", "twitter:description", "twitter:title"].includes(key) && a.content) metaLines.push(clean(a.content));
      continue;
    }

    if (name === "img" && !closing) {
      const a = attributes(rawAttrs);
      const label = clean([a.alt, a.title].filter(Boolean).join(" - "));
      if (label.length >= 3) {
        flush();
        buf = `[image: ${label}]`;
        flush();
      }
      continue;
    }

    if (name === "a") {
      if (closing) closeLink();
      else {
        closeLink();
        const a = attributes(rawAttrs);
        const href = resolveLink(a.href ?? "", base);
        if (href) openLink = { href, text: "" };
        if (a.title && a.title.length >= 3 && /soc|iso|gdpr|hipaa|trust|security|certif/i.test(a.title)) addText(` ${a.title} `);
      }
      continue;
    }

    if (BLOCK.has(name) || (name === "td" || name === "th")) {
      if (name === "td" || name === "th") {
        if (closing || buf.trim() === "") continue;
        addText(" | "); // a separator between cells, not before the first
      } else flush();
    }
    if (VOID.has(name)) continue;
  }
  addText(src.slice(last));
  closeLink();
  flush();

  const ordered = [...(title.trim() ? [`Page title: ${clean(decodeEntities(title))}`] : []), ...dedupe(metaLines), ...dedupe(lines)];
  let text = ordered.join("\n");
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
  return { title: clean(decodeEntities(title)), text, links, thin: text.length < THIN_CHARS };
}

/** Repeated lines (footer links, cookie banners shown twice) add nothing; keep the first of each. */
function dedupe(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
