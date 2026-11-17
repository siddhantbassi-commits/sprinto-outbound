import { createHash } from "node:crypto";
import { FetchError, safeFetch, type FetchDeps } from "./fetch";
import { htmlToText, type PageLink } from "./html-to-text";
import { DISALLOW_ALL, robotsAllows, robotsFromResponse, type RobotsFile } from "./robots";
import { GuardError, sameSite } from "./url-guard";

/**
 * One company's website, as the pipeline sees it. It owns the stored pages, the politeness rules (robots.txt, three
 * pages at a time, a hard page cap) and the four things the agent loop may ask for. Nothing outside this object touches
 * the network for page text, so the guard in fetch.ts covers every request.
 */

export const BOT_TOKEN = "SprintoOutboundBot";
export const botUserAgent = (contact: string) => `${BOT_TOKEN}/1.0 (+mailto:${contact})`;

export type PageKind = "home" | "about" | "pricing" | "security" | "customers" | "careers" | "other";

export interface StoredPage {
  url: string;
  kind: PageKind;
  status: number;
  bytes: number;
  sha256: string;
  title: string;
  text: string;
  thin: boolean;
  truncated: boolean;
  fetchedAt: string;
}

export interface SkippedPage {
  url: string;
  reason: string;
}

export type FetchOutcome = { ok: true; page: StoredPage; fresh: boolean } | { ok: false; reason: string };

/** The kinds the first crawl looks for, in the order they matter. */
export const CRAWL_ORDER: PageKind[] = ["about", "pricing", "security", "customers", "careers"];

/** The fixed list the agent loop may name (with anything discovered from the site's own links). */
export const CANDIDATE_PATHS: Record<Exclude<PageKind, "home" | "other">, string[]> = {
  about: ["/about", "/about-us", "/company"],
  pricing: ["/pricing", "/plans"],
  security: ["/security", "/trust", "/trust-center", "/security-and-compliance"],
  customers: ["/customers", "/case-studies"],
  careers: ["/careers", "/jobs"],
};
const ALL_CANDIDATES = new Set(Object.values(CANDIDATE_PATHS).flat());

const KIND_PATTERNS: [Exclude<PageKind, "home" | "other">, RegExp][] = [
  ["security", /^\/(security|trust|trust-center|compliance|security-and-compliance|privacy-and-security)(\/|$)/],
  ["pricing", /^\/(pricing|plans|price)(\/|$)/],
  ["customers", /^\/(customers|case-studies|customer-stories|stories|success-stories)(\/|$)/],
  ["careers", /^\/(careers|jobs|join-us|work-with-us|open-roles)(\/|$)/],
  ["about", /^\/(about|about-us|company|who-we-are|our-story)(\/|$)/],
];

export function classifyPage(rawUrl: string, linkText = ""): PageKind {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "other";
  }
  const path = u.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (path === "/") return u.hostname.startsWith("trust.") || u.hostname.startsWith("security.") ? "security" : "home";
  for (const [kind, re] of KIND_PATTERNS) if (re.test(path)) return kind;
  const t = linkText.toLowerCase().trim();
  if (t === "pricing" || t === "plans") return "pricing";
  if (t === "security" || t === "trust" || t === "trust center") return "security";
  if (t === "about" || t === "about us" || t === "company") return "about";
  if (t === "customers" || t === "case studies") return "customers";
  if (t === "careers" || t === "jobs" || t === "we're hiring") return "careers";
  return "other";
}

const JOB_BOARD_HOSTS = [
  "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com", "apply.workable.com", "jobs.smartrecruiters.com",
  "bamboohr.com", "recruitee.com", "breezy.hr", "teamtailor.com", "jobs.gusto.com", "wellfound.com",
];
export const isJobBoardHost = (host: string) => JOB_BOARD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

export interface SiteLimits {
  /** Pages the first crawl may store after the home page. */
  crawlPages: number;
  /** Everything stored for the domain, agent rounds included. */
  maxPages: number;
  concurrency: number;
  robotsTimeoutMs: number;
}
export const SITE_LIMITS: SiteLimits = { crawlPages: 5, maxPages: 12, concurrency: 3, robotsTimeoutMs: 5_000 };

export interface Site {
  readonly domain: string;
  pages(): StoredPage[];
  skipped(): SkippedPage[];
  /** URLs found on the home page, its links and the sitemap (on-site only). */
  discovered(): string[];
  /** Page texts, for the grounding check. */
  corpus(): string[];
  crawl(): Promise<void>;
  /** Restores pages stored by an earlier step, so a later step can carry on without fetching them again. */
  preload(pages: StoredPage[], discovered: string[]): void;
  fetchUrl(url: string, opts?: { jobBoard?: boolean }): Promise<FetchOutcome>;
  fetchPath(path: string): Promise<FetchOutcome>;
  searchSite(terms: string[]): { hits: { url: string; snippet: string }[]; urls: string[] };
  checkTrustCenter(): Promise<FetchOutcome>;
  listOpenRoles(): Promise<FetchOutcome>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createSite(domain: string, deps: FetchDeps & { now?: () => Date }, limits: SiteLimits = SITE_LIMITS): Site {
  const now = deps.now ?? (() => new Date());
  const stored = new Map<string, StoredPage>(); // by final URL
  const requested = new Map<string, string>(); // requested URL -> final URL
  const linksByPage = new Map<string, PageLink[]>();
  const skipped: SkippedPage[] = [];
  const discovered = new Set<string>();
  const robots = new Map<string, RobotsFile>();

  const skip = (url: string, reason: string): FetchOutcome => {
    skipped.push({ url, reason });
    return { ok: false, reason };
  };

  async function robotsFor(url: URL): Promise<RobotsFile> {
    const key = url.origin;
    const cached = robots.get(key);
    if (cached) return cached;
    let file: RobotsFile;
    try {
      const res = await safeFetch(`${url.origin}/robots.txt`, deps, { accept: "text", timeoutMs: limits.robotsTimeoutMs, maxBytes: 512 * 1024 });
      file = robotsFromResponse(res.status, res.body);
    } catch (e) {
      // A guard refusal is the host's problem, not a missing file. Anything else unreadable means we do not crawl.
      if (e instanceof GuardError) throw e;
      file = DISALLOW_ALL;
    }
    robots.set(key, file);
    return file;
  }

  const onSite = (u: URL) => sameSite(domain, u.hostname);

  async function fetchUrl(rawUrl: string, opts: { jobBoard?: boolean } = {}): Promise<FetchOutcome> {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return skip(rawUrl, "Not a valid address");
    }
    u.hash = "";
    const target = u.href;
    const known = requested.get(target) ?? target;
    const have = stored.get(known);
    if (have) return { ok: true, page: have, fresh: false };

    if (opts.jobBoard ? !isJobBoardHost(u.hostname) : !onSite(u)) return skip(target, "Not on this company's site");
    if (stored.size >= limits.maxPages) return skip(target, `Page limit reached (${limits.maxPages})`);

    try {
      const file = await robotsFor(u);
      if (!robotsAllows(file, BOT_TOKEN, `${u.pathname}${u.search}`)) return skip(target, "Disallowed by robots.txt");
      const res = await safeFetch(target, deps, { accept: "html" });
      if (res.status < 200 || res.status >= 300) return skip(target, `HTTP ${res.status}`);
      const finalUrl = new URL(res.url);
      finalUrl.hash = "";
      requested.set(target, finalUrl.href);
      const existing = stored.get(finalUrl.href);
      if (existing) return { ok: true, page: existing, fresh: false };
      const parsed = htmlToText(res.body, finalUrl.href);
      const kind = classifyPage(finalUrl.href);
      const page: StoredPage = {
        url: finalUrl.href,
        kind,
        status: res.status,
        bytes: res.bytes,
        sha256: sha256(res.body),
        title: parsed.title,
        text: parsed.text,
        thin: parsed.thin,
        truncated: res.truncated,
        fetchedAt: now().toISOString(),
      };
      stored.set(page.url, page);
      linksByPage.set(page.url, parsed.links);
      for (const link of parsed.links) {
        try {
          const lu = new URL(link.href);
          if (onSite(lu) && !/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|mp4|woff2?)$/i.test(lu.pathname)) discovered.add(lu.href);
        } catch {
          /* ignore */
        }
      }
      return { ok: true, page, fresh: true };
    } catch (e) {
      if (e instanceof GuardError) return skip(target, `Refused: ${e.message}`);
      if (e instanceof FetchError) return skip(target, e.message);
      return skip(target, "Could not be fetched");
    }
  }

  async function loadSitemap(origin: string) {
    try {
      const res = await safeFetch(`${origin}/sitemap.xml`, deps, { accept: "text", timeoutMs: limits.robotsTimeoutMs, maxBytes: 1_000_000 });
      if (res.status < 200 || res.status >= 300) return;
      let count = 0;
      for (const m of res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        if (count >= 500) break;
        try {
          const u = new URL((m[1] ?? "").replace(/&amp;/g, "&"));
          if (onSite(u) && !u.pathname.endsWith(".xml")) {
            discovered.add(u.href);
            count += 1;
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* a missing or unreadable sitemap is normal */
    }
  }

  /** The best discovered address for a kind: shortest path, so /pricing beats /pricing/enterprise-faq. */
  function bestDiscovered(kind: PageKind, links: PageLink[]): string | null {
    const labels = new Map(links.map((l) => [l.href, l.text]));
    const matches = [...discovered].filter((href) => classifyPage(href, labels.get(href) ?? "") === kind);
    matches.sort((a, b) => new URL(a).pathname.length - new URL(b).pathname.length);
    return matches[0] ?? null;
  }

  async function crawl() {
    let home: FetchOutcome = await fetchUrl(`https://${domain}/`);
    if (!home.ok && /connect|closed|refused|timed? ?out|No full response/i.test(home.reason)) home = await fetchUrl(`http://${domain}/`);
    if (!home.ok) return;
    const origin = new URL(home.page.url).origin;
    await loadSitemap(origin);

    const links = linksByPage.get(home.page.url) ?? [];
    const candidates: string[] = [];
    for (const kind of CRAWL_ORDER) {
      const found = bestDiscovered(kind, links);
      if (found) candidates.push(found);
    }
    for (const kind of CRAWL_ORDER) {
      if (candidates.some((c) => classifyPage(c) === kind)) continue;
      const first = CANDIDATE_PATHS[kind as keyof typeof CANDIDATE_PATHS]?.[0];
      if (first) candidates.push(`${origin}${first}`);
    }

    let attempts = 0;
    let index = 0;
    const target = 1 + limits.crawlPages;
    while (index < candidates.length && stored.size < target && attempts < 10) {
      const room = Math.min(limits.concurrency, target - stored.size, candidates.length - index);
      const batch = candidates.slice(index, index + room);
      index += room;
      attempts += room;
      await Promise.all(batch.map((url) => fetchUrl(url)));
    }
  }

  const siteOrigin = () => {
    const first = stored.values().next().value as StoredPage | undefined;
    return first ? new URL(first.url).origin : `https://${domain}`;
  };

  function normalisePath(path: string): string | null {
    const p = path.trim();
    if (p.length === 0 || p.length > 200 || !p.startsWith("/") || p.startsWith("//") || /[\s\\\u0000-\u001f]/.test(p)) return null;
    return p.split(/[?#]/)[0] || "/";
  }

  const knownPaths = () => new Set([...discovered].map((href) => new URL(href).pathname.replace(/\/+$/, "") || "/"));

  async function fetchPath(path: string): Promise<FetchOutcome> {
    const p = normalisePath(path);
    if (!p) return skip(path, "Not a valid path");
    const bare = p.replace(/\/+$/, "") || "/";
    if (!ALL_CANDIDATES.has(bare) && !knownPaths().has(bare)) return skip(p, "That path is not one this site links to or one we try");
    return fetchUrl(`${siteOrigin()}${p}`);
  }

  function searchSite(terms: string[]) {
    const needles = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2).slice(0, 6);
    const hits: { url: string; snippet: string }[] = [];
    if (needles.length === 0) return { hits, urls: [] };
    for (const page of stored.values()) {
      for (const line of page.text.split("\n")) {
        const lower = line.toLowerCase();
        if (needles.some((n) => lower.includes(n))) {
          hits.push({ url: page.url, snippet: line.slice(0, 240) });
          if (hits.length >= 8) break;
        }
      }
      if (hits.length >= 8) break;
    }
    const urls = [...discovered].filter((href) => needles.some((n) => href.toLowerCase().includes(n))).slice(0, 10);
    return { hits, urls };
  }

  async function checkTrustCenter(): Promise<FetchOutcome> {
    const origin = siteOrigin();
    const apex = domain.replace(/^www\./, "");
    const tries = [
      ...CANDIDATE_PATHS.security.map((p) => `${origin}${p}`),
      `https://trust.${apex}/`,
      `https://security.${apex}/`,
    ];
    let last: FetchOutcome = { ok: false, reason: "No trust or security page found" };
    for (const url of tries.slice(0, 6)) {
      const out = await fetchUrl(url);
      if (out.ok) return out;
      last = out;
    }
    return last;
  }

  async function listOpenRoles(): Promise<FetchOutcome> {
    const all = [...linksByPage.values()].flat();
    const careers = bestDiscovered("careers", all);
    let outcome: FetchOutcome = { ok: false, reason: "No careers page or job board found" };
    const origin = siteOrigin();
    for (const url of careers ? [careers] : CANDIDATE_PATHS.careers.map((p) => `${origin}${p}`).slice(0, 2)) {
      outcome = await fetchUrl(url);
      if (outcome.ok) break;
    }
    // A job board counts only if the company's own pages link to it.
    const board = all.find((l) => {
      try {
        return isJobBoardHost(new URL(l.href).hostname);
      } catch {
        return false;
      }
    });
    if (board) {
      const b = await fetchUrl(board.href, { jobBoard: true });
      if (b.ok) return b;
    }
    return outcome;
  }

  function preload(pages: StoredPage[], urls: string[]) {
    for (const p of pages) {
      stored.set(p.url, p);
      requested.set(p.url, p.url);
    }
    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (onSite(parsed)) discovered.add(parsed.href);
      } catch {
        /* a stored address that no longer parses is dropped */
      }
    }
  }

  return {
    domain,
    preload,
    pages: () => [...stored.values()],
    skipped: () => [...skipped],
    discovered: () => [...discovered],
    corpus: () => [...stored.values()].map((p) => p.text),
    crawl,
    fetchUrl,
    fetchPath,
    searchSite,
    checkTrustCenter,
    listOpenRoles,
  };
}
