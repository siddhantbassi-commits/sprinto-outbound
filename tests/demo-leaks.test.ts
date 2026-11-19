import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_COMPANIES, DEMO_DISCOVERABLE } from "@/lib/demo/companies";

/**
 * The demo's invented companies must not show up in the real app's screens: an example that names a company that does not exist
 * (or, worse, one that does) misleads and can start real work on strangers. The one place that keeps them on purpose is the demo
 * example list, which is only shown in demo mode.
 */
const ROOT = join(__dirname, "..", "src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

describe("demo companies stay in the demo", () => {
  const domains = [...DEMO_COMPANIES, ...DEMO_DISCOVERABLE].map((c) => c.domain).filter((d) => d !== "vanta.com");
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].filter((f) => /\.tsx?$/.test(f));

  it("finds the screens it is meant to check", () => {
    expect(domains.length).toBeGreaterThan(8);
    expect(files.length).toBeGreaterThan(40);
  });

  it("names a demo company only in the demo example list", () => {
    const offenders = files.filter((f) => domains.some((d) => readFileSync(f, "utf8").includes(d))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([join("app", "(app)", "runs", "new", "form.tsx")]);
    expect(readFileSync(join(ROOT, "app", "(app)", "runs", "new", "form.tsx"), "utf8")).toMatch(/facts\.demo \? EXAMPLE_DEMO : EXAMPLE_REAL/);
  });
});
