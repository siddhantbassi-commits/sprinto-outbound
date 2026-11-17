import { describe, expect, it } from "vitest";
import { classifyPage, createSite, isJobBoardHost, SITE_LIMITS } from "@/lib/scrape/site";
import { fakeWeb, page, redirect, type Route } from "./fakeweb";

const body = (title: string, extra = "") => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${"We build compliance software for growing SaaS teams. ".repeat(12)}</p>${extra}</main></body></html>`;

const HOME = `<html><head><title>Acme</title></head><body>
<nav><a href="/pricing">Pricing</a><a href="/security">Security</a><a href="/about">About</a></nav>
<main><h1>Acme</h1><p>${"Acme builds cloud tooling for engineering teams everywhere. ".repeat(10)}</p>
<a href="/customers">Customers</a> <a href="/careers">Careers</a> <a href="https://other.com/x">Partner</a>
<footer><img alt="SOC 2 Type II" src="/b.png"></footer></main></body></html>`;

const SITE: Record<string, Route | string> = {
  "https://acme.com/": page(HOME),
  "https://acme.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /admin\n" },
  "https://acme.com/pricing": page(body("Pricing", "Enterprise plan with SSO")),
  "https://acme.com/security": page(body("Security")),
  "https://acme.com/about": page(body("About")),
  "https://acme.com/customers": page(body("Customers")),
  "https://acme.com/careers": page(body("Careers", "<p>Security Engineer</p>")),
};

describe("classifyPage", () => {
  it.each([
    ["https://acme.com/", "home"],
    ["https://acme.com/pricing", "pricing"],
    ["https://acme.com/pricing/", "pricing"],
    ["https://acme.com/Plans", "pricing"],
    ["https://acme.com/security", "security"],
    ["https://acme.com/trust-center", "security"],
    ["https://trust.acme.com/", "security"],
    ["https://acme.com/about-us", "about"],
    ["https://acme.com/case-studies/foo", "customers"],
    ["https://acme.com/jobs", "careers"],
    ["https://acme.com/blog/we-raised", "other"],
    ["not a url", "other"],
  ])("%s is %s", (url, kind) => expect(classifyPage(url)).toBe(kind));

  it("uses the link text when the path is not telling", () => {
    expect(classifyPage("https://acme.com/p/7", "Pricing")).toBe("pricing");
    expect(classifyPage("https://acme.com/p/8", "Trust Center")).toBe("security");
    expect(classifyPage("https://acme.com/p/9", "Read more")).toBe("other");
  });
});

describe("isJobBoardHost", () => {
  it("accepts known boards and their subdomains, and nothing that merely ends similarly", () => {
    expect(isJobBoardHost("boards.greenhouse.io")).toBe(true);
    expect(isJobBoardHost("acme.bamboohr.com")).toBe(true);
    expect(isJobBoardHost("evil-bamboohr.com")).toBe(false);
    expect(isJobBoardHost("bamboohr.com.evil.io")).toBe(false);
    expect(isJobBoardHost("acme.com")).toBe(false);
  });
});

describe("crawl", () => {
  it("stores the home page and the pages its own links point to, in priority order", async () => {
    const web = fakeWeb(SITE);
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    const kinds = site.pages().map((p) => p.kind);
    expect(kinds[0]).toBe("home");
    expect(new Set(kinds)).toEqual(new Set(["home", "about", "pricing", "security", "customers", "careers"]));
    expect(site.pages()).toHaveLength(6);
  });

  it("records what each page is: hash, size, title, time", async () => {
    const web = fakeWeb(SITE);
    const site = createSite("acme.com", { ...web.deps, now: () => new Date("2026-11-03T10:00:00Z") });
    await site.crawl();
    const home = site.pages()[0]!;
    expect(home.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(home.title).toBe("Acme");
    expect(home.fetchedAt).toBe("2026-11-03T10:00:00.000Z");
    expect(home.thin).toBe(false);
    expect(home.text).toContain("[image: SOC 2 Type II]");
  });

  it("never fetches a page on another company's site", async () => {
    const web = fakeWeb(SITE);
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(web.urls().some((u) => u.includes("other.com"))).toBe(false);
  });

  it("fetches at most three pages at a time", async () => {
    const slow: Record<string, Route | string> = { ...SITE };
    for (const k of ["pricing", "security", "about", "customers", "careers"]) slow[`https://acme.com/${k}`] = { ...(page(body(k)) as Route), delayMs: 25 };
    const web = fakeWeb(slow);
    await createSite("acme.com", web.deps).crawl();
    expect(web.stats.maxInFlight).toBeLessThanOrEqual(SITE_LIMITS.concurrency);
    expect(web.stats.maxInFlight).toBeGreaterThan(1);
  });

  it("falls back to common paths when the home page does not link to them", async () => {
    const web = fakeWeb({
      "https://acme.com/": page(body("Home")),
      "https://acme.com/pricing": page(body("Pricing")),
      "https://acme.com/security": page(body("Security")),
    });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages().map((p) => p.kind).sort()).toEqual(["home", "pricing", "security"]);
    expect(site.skipped().length).toBeGreaterThan(0);
  });

  it("finds pages through the sitemap too", async () => {
    const web = fakeWeb({
      "https://acme.com/": page(body("Home")),
      "https://acme.com/sitemap.xml": { type: "application/xml", body: `<urlset><url><loc>https://acme.com/plans-and-pricing/pricing</loc></url><url><loc>https://acme.com/case-studies/globex</loc></url><url><loc>https://elsewhere.com/pricing</loc></url></urlset>` },
      "https://acme.com/plans-and-pricing/pricing": page(body("Pricing deep")),
      "https://acme.com/case-studies/globex": page(body("Globex story")),
    });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.discovered()).toContain("https://acme.com/case-studies/globex");
    expect(site.discovered().some((u) => u.includes("elsewhere.com"))).toBe(false);
    expect(site.pages().some((p) => p.url.endsWith("/case-studies/globex"))).toBe(true);
  });

  it("follows the apex to www redirect and stores the page under its real address", async () => {
    const web = fakeWeb({
      "https://acme.com/": redirect("https://www.acme.com/"),
      "https://www.acme.com/": page(HOME),
      "https://www.acme.com/robots.txt": { type: "text/plain", body: "" },
    });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages()[0]!.url).toBe("https://www.acme.com/");
    expect(web.urls().filter((u) => u.endsWith("/pricing")).every((u) => u.startsWith("https://www.acme.com"))).toBe(true);
  });

  it("tries plain http when https cannot connect", async () => {
    const web = fakeWeb({ "https://acme.com/": { error: Object.assign(new Error("x"), { name: "FetchError" }) }, "http://acme.com/": page(body("Home")) });
    const orig = web.deps.transport;
    web.deps.transport = async (r) => {
      if (r.url.href === "https://acme.com/") {
        const { FetchError } = await import("@/lib/scrape/fetch");
        throw new FetchError("network", "Could not connect");
      }
      return orig(r);
    };
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages()[0]!.url).toBe("http://acme.com/");
  });

  it("stores nothing, and says why, when the home page is not there", async () => {
    const web = fakeWeb({ "https://acme.com/": { status: 500, body: "boom" } });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages()).toHaveLength(0);
    expect(site.skipped()[0]).toMatchObject({ url: "https://acme.com/", reason: "HTTP 500" });
  });

  it("flags a page with almost no text as thin", async () => {
    const web = fakeWeb({ "https://acme.com/": page(`<div id="root"></div><script src="/app.js"></script>`) });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages()[0]!.thin).toBe(true);
  });

  it("refuses a host that resolves privately and records it as refused", async () => {
    const web = fakeWeb(SITE, { dns: { "acme.com": ["10.0.0.1"] } });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages()).toHaveLength(0);
    expect(site.skipped()[0]?.reason).toMatch(/Refused: .*private or reserved/);
    expect(web.calls).toHaveLength(0);
  });
});

describe("robots.txt", () => {
  it("skips pages robots.txt disallows and says so", async () => {
    const web = fakeWeb({ ...SITE, "https://acme.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /pricing\n" } });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages().some((p) => p.kind === "pricing")).toBe(false);
    expect(site.skipped()).toContainEqual({ url: "https://acme.com/pricing", reason: "Disallowed by robots.txt" });
    expect(web.urls()).not.toContain("https://acme.com/pricing");
  });

  it("fetches nothing when the whole site is disallowed for us", async () => {
    const web = fakeWeb({ ...SITE, "https://acme.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" } });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(site.pages()).toHaveLength(0);
    expect(web.urls().filter((u) => !u.endsWith("robots.txt"))).toEqual([]);
  });

  it("treats a missing robots.txt as allow-all and a broken one as disallow-all", async () => {
    const missing = fakeWeb({ ...SITE, "https://acme.com/robots.txt": { status: 404, body: "" } });
    const a = createSite("acme.com", missing.deps);
    await a.crawl();
    expect(a.pages().length).toBeGreaterThan(1);

    const broken = fakeWeb({ ...SITE, "https://acme.com/robots.txt": { status: 503, body: "" } });
    const b = createSite("acme.com", broken.deps);
    await b.crawl();
    expect(b.pages()).toHaveLength(0);
  });

  it("asks for robots.txt once per host", async () => {
    const web = fakeWeb(SITE);
    await createSite("acme.com", web.deps).crawl();
    expect(web.urls().filter((u) => u.endsWith("/robots.txt"))).toHaveLength(1);
  });
});

describe("limits", () => {
  it("stops storing at the page cap, even across agent rounds", async () => {
    const routes: Record<string, Route | string> = { "https://acme.com/": page(body("Home")) };
    for (let i = 0; i < 30; i += 1) routes[`https://acme.com/p${i}`] = page(body(`P${i}`));
    const web = fakeWeb(routes);
    const site = createSite("acme.com", web.deps, { ...SITE_LIMITS, maxPages: 3 });
    await site.crawl();
    for (let i = 0; i < 10; i += 1) await site.fetchUrl(`https://acme.com/p${i}`);
    expect(site.pages().length).toBeLessThanOrEqual(3);
    expect(site.skipped().some((s) => /Page limit/.test(s.reason))).toBe(true);
  });

  it("does not fetch the same page twice", async () => {
    const web = fakeWeb(SITE);
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    const before = web.calls.length;
    const again = await site.fetchUrl("https://acme.com/pricing");
    expect(again).toMatchObject({ ok: true, fresh: false });
    expect(web.calls.length).toBe(before);
  });
});

describe("agent tools: fetchPath", () => {
  const crawled = async () => {
    const web = fakeWeb({ ...SITE, "https://acme.com/trust": page(body("Trust")), "https://acme.com/blog/launch": page(body("Launch")), "https://acme.com/admin": page(body("Admin")) });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    return { web, site };
  };

  it("fetches a path from the fixed candidate list", async () => {
    const { site } = await crawled();
    expect(await site.fetchPath("/trust")).toMatchObject({ ok: true, fresh: true });
  });

  it("refuses a path that is neither linked from the site nor a candidate", async () => {
    const { site, web } = await crawled();
    const before = web.calls.length;
    const out = await site.fetchPath("/some/guess");
    expect(out).toMatchObject({ ok: false });
    expect(web.calls.length).toBe(before);
  });

  it.each([
    ["a full URL", "https://evil.com/pricing"],
    ["a protocol-relative URL", "//evil.com/pricing"],
    ["the metadata address", "http://169.254.169.254/latest"],
    ["a path without a slash", "pricing"],
    ["control characters", "/pricing\r\nHost: evil.com"],
    ["a backslash", "/\\evil.com"],
    ["an empty path", ""],
    ["a very long path", `/${"a".repeat(300)}`],
  ])("refuses %s", async (_n, path) => {
    const { site, web } = await crawled();
    const before = web.calls.length;
    expect(await site.fetchPath(path)).toMatchObject({ ok: false });
    expect(web.calls.length).toBe(before);
  });

  it("drops the query string, so a candidate path cannot smuggle parameters", async () => {
    const { site, web } = await crawled();
    await site.fetchPath("/trust?next=http://evil.com");
    expect(web.urls().filter((u) => u.includes("evil.com"))).toEqual([]);
    expect(web.urls()).toContain("https://acme.com/trust");
  });

  it("still obeys robots.txt for an allowed path", async () => {
    const { site } = await crawled();
    expect(await site.fetchPath("/admin")).toMatchObject({ ok: false });
  });
});

describe("agent tools: searchSite", () => {
  it("searches stored text and discovered URLs without any network call", async () => {
    const web = fakeWeb(SITE);
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    const before = web.calls.length;
    const { hits, urls } = site.searchSite(["SSO", "careers"]);
    expect(hits.some((h) => h.snippet.includes("SSO"))).toBe(true);
    expect(urls).toContain("https://acme.com/careers");
    expect(web.calls.length).toBe(before);
  });

  it("returns nothing for empty or one-letter terms", async () => {
    const site = createSite("acme.com", fakeWeb(SITE).deps);
    await site.crawl();
    expect(site.searchSite(["", "a"])).toEqual({ hits: [], urls: [] });
  });
});

describe("agent tools: checkTrustCenter", () => {
  it("finds a trust page on a trust sub-domain", async () => {
    const web = fakeWeb({ "https://acme.com/": page(body("Home")), "https://trust.acme.com/": page(body("Acme Trust Center")) });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    const out = await site.checkTrustCenter();
    expect(out).toMatchObject({ ok: true });
    expect(out.ok && out.page.url).toBe("https://trust.acme.com/");
    expect(out.ok && out.page.kind).toBe("security");
  });

  it("says so, with a reason, when there is none", async () => {
    const site = createSite("acme.com", fakeWeb({ "https://acme.com/": page(body("Home")) }).deps);
    await site.crawl();
    expect(await site.checkTrustCenter()).toMatchObject({ ok: false });
  });

  it("copes with a sub-domain that does not resolve", async () => {
    const web = fakeWeb({ "https://acme.com/": page(body("Home")) }, { dns: { "trust.acme.com": [], "security.acme.com": [] } });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    await expect(site.checkTrustCenter()).resolves.toMatchObject({ ok: false });
  });
});

describe("agent tools: listOpenRoles", () => {
  it("reads the company's careers page", async () => {
    const site = createSite("acme.com", fakeWeb(SITE).deps);
    await site.crawl();
    const out = await site.listOpenRoles();
    expect(out.ok && out.page.kind).toBe("careers");
  });

  it("follows a job board only when the company's own pages link to it", async () => {
    const linked = fakeWeb({
      "https://acme.com/": page(body("Home", `<a href="/careers">Careers</a>`)),
      "https://acme.com/careers": page(body("Careers", `<a href="https://boards.greenhouse.io/acme">Open roles</a>`)),
      "https://boards.greenhouse.io/robots.txt": { type: "text/plain", body: "" },
      "https://boards.greenhouse.io/acme": page(body("Jobs at Acme", "<p>Security Engineer</p>")),
    });
    const a = createSite("acme.com", linked.deps);
    await a.crawl();
    const out = await a.listOpenRoles();
    expect(out.ok && out.page.url).toBe("https://boards.greenhouse.io/acme");

    const unlinked = fakeWeb({
      "https://acme.com/": page(body("Home", `<a href="/careers">Careers</a>`)),
      "https://acme.com/careers": page(body("Careers")),
      "https://boards.greenhouse.io/acme": page(body("Jobs at Acme")),
    });
    const b = createSite("acme.com", unlinked.deps);
    await b.crawl();
    await b.listOpenRoles();
    expect(unlinked.urls().some((u) => u.includes("greenhouse"))).toBe(false);
  });

  it("never follows a link to a host that is not an allow-listed job board", async () => {
    const web = fakeWeb({
      "https://acme.com/": page(body("Home", `<a href="/careers">Careers</a>`)),
      "https://acme.com/careers": page(body("Careers", `<a href="https://jobs.evil.com/acme">Open roles</a>`)),
    });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    await site.listOpenRoles();
    expect(web.urls().some((u) => u.includes("evil.com"))).toBe(false);
  });

  it("will not treat a job-board URL as an ordinary on-site page", async () => {
    const web = fakeWeb({ "https://acme.com/": page(body("Home")) });
    const site = createSite("acme.com", web.deps);
    await site.crawl();
    expect(await site.fetchUrl("https://boards.greenhouse.io/acme")).toMatchObject({ ok: false, reason: "Not on this company's site" });
  });
});

describe("preload (a later step carrying on from stored pages)", () => {
  it("restores pages and discovered addresses so a path the home page linked to can be fetched, without refetching what is stored", async () => {
    const first = fakeWeb(SITE);
    const a = createSite("acme.com", first.deps);
    await a.crawl();
    const stored = a.pages();
    const found = a.discovered();

    const second = fakeWeb(SITE);
    const b = createSite("acme.com", second.deps);
    b.preload(stored, found);
    expect(b.pages()).toHaveLength(stored.length);
    expect(await b.fetchUrl("https://acme.com/pricing")).toMatchObject({ ok: true, fresh: false });
    expect(second.calls).toHaveLength(0);
    expect(b.searchSite(["SSO"]).hits.length).toBeGreaterThan(0);
  });

  it("drops a discovered address that is off-site or not an address", async () => {
    const b = createSite("acme.com", fakeWeb({}).deps);
    b.preload([], ["https://evil.com/x", "not a url", "https://acme.com/ok"]);
    expect(b.discovered()).toEqual(["https://acme.com/ok"]);
  });
});
