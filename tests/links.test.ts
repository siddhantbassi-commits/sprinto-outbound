import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { actionFor, buildReadiness, type ReadinessInput, type ReadyItem } from "@/lib/app/readiness";
import { TOUR } from "@/lib/app/tour";

/**
 * Every link in the app has to lead somewhere real. This reads the source, finds every internal link (a <Link href>, a data
 * table's href, a redirect), and checks three things: the page exists, a #field it names exists on that page, and a link that
 * carries no query or field does not point at the very page it sits on (a button that seems to do nothing).
 */

const ROOT = join(__dirname, "..", "src");
const APP = join(ROOT, "app");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** The URL path a page or route file serves: route groups vanish, [id] stays as a pattern. */
const routeOf = (file: string): string | null => {
  const rel = relative(APP, file).split(sep);
  const last = rel[rel.length - 1]!;
  if (!/^(page|route)\.tsx?$/.test(last)) return null;
  const parts = rel.slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + parts.join("/");
};

const files = walk(ROOT).filter((f) => /\.(tsx?|mjs)$/.test(f));
const routes = files.map((f) => ({ file: f, route: routeOf(f) })).filter((r): r is { file: string; route: string } => r.route !== null && f_in_app(r.file));
function f_in_app(f: string) {
  return f.startsWith(APP + sep);
}
const patterns = [...new Set(routes.map((r) => r.route))];

const matches = (route: string, path: string) => {
  const a = route.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  return a.length === b.length && a.every((seg, i) => /^\[.+\]$/.test(seg) || seg === b[i]);
};

interface Found {
  file: string;
  raw: string;
  path: string;
  query: boolean;
  hash: string | null;
  dynamic: boolean;
}

const LINK = /(?:href\s*[=:]\s*\{?|redirect\(|router\.(?:push|replace)\()\s*([`"'])(\/[^`"']*)\1/g;

function linksIn(file: string): Found[] {
  const src = readFileSync(file, "utf8");
  const out: Found[] = [];
  for (const m of src.matchAll(LINK)) {
    const raw = m[2]!;
    const dynamic = raw.includes("${");
    // A placeholder inside a path (/prospects/${id}/brief) stands for one segment. One glued onto the end (/leads${query}) is a
    // query or a suffix, so only what comes before it is the path.
    const cut = raw.indexOf("${");
    const flat = cut >= 0 && !raw.slice(0, cut).endsWith("/") ? raw.slice(0, cut) : raw.replace(/\$\{[^}]*\}/g, "x");
    const [beforeHash, hash] = flat.split("#");
    const [path, query] = beforeHash!.split("?");
    out.push({ file, raw, path: path || "/", query: query !== undefined || (cut >= 0 && !raw.slice(0, cut).endsWith("/")), hash: hash ?? null, dynamic });
  }
  return out;
}

// Pages that are links' homes. The demo's pretend websites also use href, and are not part of the app.
const scanned = files.filter((f) => !f.includes(`${sep}demo${sep}`) && !f.includes(`${sep}scrape${sep}`) && !f.endsWith("not-found.tsx") || f.endsWith("not-found.tsx"));
const all = scanned.flatMap(linksIn);

describe("every internal link goes somewhere real", () => {
  it("finds a sensible number of links, so the check itself is not empty", () => {
    expect(all.length).toBeGreaterThan(60);
    expect(patterns).toContain("/settings");
    expect(patterns).toContain("/prospects/[id]/brief");
  });

  it("points only at pages and routes that exist", () => {
    // These are served by the framework or an API rather than a page file.
    const bad = all.filter((l) => !patterns.some((p) => matches(p, l.path)));
    expect(bad.map((l) => `${relative(ROOT, l.file)} -> ${l.raw}`)).toEqual([]);
  });

  it("names, after a #, a field or section that exists on that page", () => {
    const withHash = all.filter((l) => l.hash);
    expect(withHash.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const l of withHash) {
      const targets = routes.filter((r) => matches(r.route, l.path));
      // The page and everything beside it (its forms and components) may carry the id.
      const text = targets.map((t) => walk(join(t.file, "..")).filter((f) => /\.tsx$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n")).join("\n");
      const id = l.hash!;
      const has = new RegExp(`id=["'{]+\\s*["'\`]?${id}["'\`]|id:\\s*["']${id}["']|\\["${id}",`).test(text);
      if (!has) missing.push(`${relative(ROOT, l.file)} -> ${l.raw}`);
    }
    expect(missing).toEqual([]);
  });

  it("never links a page to itself without a query or a field, which would seem to do nothing", () => {
    const own = new Map(routes.map((r) => [r.file, r.route]));
    const selfLinks: string[] = [];
    for (const l of all) {
      if (l.dynamic || l.query || l.hash) continue;
      // The app-wide shell is on every page, so a link in it is navigation, not a button on one page.
      if (/(layout|template|loading|error|not-found)\.tsx$/.test(l.file)) continue;
      // The page this link is written on: the page file beside it, or the one it is rendered by.
      const dir = join(l.file, "..");
      const page = [...own.entries()].find(([f]) => join(f, "..") === dir && /page\.tsx$/.test(f));
      if (page && matches(page[1], l.path) && page[1] === l.path) selfLinks.push(`${relative(ROOT, l.file)} -> ${l.raw}`);
    }
    expect(selfLinks).toEqual([]);
  });
});

describe("a checklist never offers a button that goes nowhere", () => {
  const BASE: ReadinessInput = { mode: "supabase", testTo: null, postalAddress: "600020", icpSignedVersion: null, factsProblems: ["x"], geminiSet: false, gmailSet: false, hunter: null, lastTick: null, now: Date.parse("2026-11-19T10:00:00Z"), waiting: 3, reserve: 3 };
  const items = buildReadiness(BASE).items;

  it("covers every item, so none is skipped", () => {
    expect(items.map((i) => i.id).sort()).toEqual(["address", "facts", "gemini", "gmail", "hunter", "icp", "test", "worker"]);
  });

  it("gives each item a button on each page it is shown on, only when that button goes somewhere else", () => {
    for (const here of ["/", "/settings"]) {
      for (const item of items) {
        const a = actionFor(item, here);
        if (a.kind === "link") {
          const [path, hash] = a.href.split("#");
          expect(patterns.some((p) => matches(p, path!)), `${item.id} on ${here} -> ${a.href}`).toBe(true);
          expect(path === here && !hash, `${item.id} on ${here} links to itself`).toBe(false);
        } else {
          expect(a.label.length, `${item.id} note`).toBeGreaterThan(3);
        }
      }
    }
  });

  it("takes the postal address and the test address straight to their own fields", () => {
    const byId = (id: string) => items.find((i) => i.id === id) as ReadyItem;
    expect(actionFor(byId("address"), "/settings")).toMatchObject({ kind: "link", href: "/settings#postal-address" });
    expect(actionFor(byId("address"), "/")).toMatchObject({ kind: "link", href: "/settings#postal-address" });
    expect(actionFor(byId("test"), "/settings")).toMatchObject({ kind: "link", href: "/settings#test-to" });
    expect(actionFor(byId("facts"), "/settings")).toMatchObject({ kind: "link", href: "/settings#claims" });
  });

  it("explains instead of linking when the fix is on the host, or is the page you are already on", () => {
    const byId = (id: string) => items.find((i) => i.id === id) as ReadyItem;
    expect(actionFor(byId("gemini"), "/settings")).toEqual({ kind: "note", label: "Set on the host" });
    expect(actionFor(byId("gmail"), "/")).toEqual({ kind: "note", label: "Set on the host" });
    expect(actionFor(byId("worker"), "/").kind).toBe("note");
    expect(actionFor(byId("worker"), "/settings")).toMatchObject({ kind: "link", href: "/" });
  });
});

describe("the guided tour points at real things", () => {
  const sources = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const layout = readFileSync(join(APP, "(app)", "layout.tsx"), "utf8");

  it("shows each stop on a page that exists", () => {
    for (const step of TOUR) if (step.path) expect(patterns.some((p) => matches(p, step.path!)), `${step.id} -> ${step.path}`).toBe(true);
  });

  it("points each stop at a part of the page that exists", () => {
    for (const step of TOUR) {
      if (!step.anchor) continue;
      if (step.anchor.startsWith("nav")) {
        // A menu item is anchored by its address, so the menu must really have an item for it.
        const href = step.anchor.slice(3) || "/";
        expect(layout.includes(`href: "${href}"`), `${step.id}: no menu item for ${href}`).toBe(true);
      } else {
        expect(sources.includes(`data-tour="${step.anchor}"`), `${step.id}: nothing is marked data-tour="${step.anchor}"`).toBe(true);
      }
    }
  });
});
