import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stepsFor, TOUR, TOUR_KEY } from "@/lib/app/tour";

const SRC = join(process.cwd(), "src");
const all = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? all(p) : p.endsWith(".tsx") ? [p] : []; });
const sources = all(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
const layout = readFileSync(join(SRC, "app/(app)/layout.tsx"), "utf8");

describe("the first-visit tour", () => {
  it("has unique steps that begin by welcoming and end by saying it is over", () => {
    expect(new Set(TOUR.map((s) => s.id)).size).toBe(TOUR.length);
    expect(TOUR[0]!.id).toBe("welcome");
    expect(TOUR.at(-1)!.id).toBe("done");
  });

  it("only visits pages that exist", () => {
    for (const s of TOUR) {
      if (!s.path) continue;
      const dir = s.path === "/" ? join(SRC, "app/(app)") : join(SRC, "app/(app)", s.path);
      expect(existsSync(join(dir, "page.tsx")), `${s.id} → ${s.path}`).toBe(true);
    }
  });

  it("only points at things that are on the page: a navigation link the shell really shows, or an anchor in the source", () => {
    for (const s of TOUR) {
      if (!s.anchor) continue;
      if (s.anchor.startsWith("nav")) {
        const href = s.anchor.slice(3);
        expect(layout, `${s.id}: nav item ${href}`).toContain(`href: "${href}"`);
      } else {
        expect(sources, `${s.id}: data-tour="${s.anchor}"`).toContain(`data-tour="${s.anchor}"`);
      }
    }
    expect(sources).toContain("data-tour={`nav${i.href}`}");
  });

  it("leaves out the pages a viewer cannot open", () => {
    const viewer = stepsFor(false).map((s) => s.id);
    const operator = stepsFor(true).map((s) => s.id);
    expect(viewer).not.toContain("discover");
    expect(viewer).not.toContain("paste");
    expect(operator).toEqual(TOUR.map((s) => s.id));
    for (const s of stepsFor(false)) expect(s.operatorOnly).toBeFalsy();
  });

  it("makes no promise the product does not keep", () => {
    const text = TOUR.map((s) => `${s.title} ${s.body}`).join(" ");
    expect(text).toMatch(/test mode delivers only to your own address/i);
    expect(text).not.toMatch(/guarantee|automatically send|fully automated|never wrong/i);
  });

  it("is remembered under one key, and can be started from the app bar and the command palette", () => {
    expect(TOUR_KEY).toBe("sprinto.tour.v1");
    expect(sources).toContain('"tour:start"');
    expect(layout).toContain('action: "tour"');
    expect(layout).toContain("<TourButton />");
  });
});
