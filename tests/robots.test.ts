import { describe, expect, it } from "vitest";
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, robotsAllows, robotsFromResponse } from "@/lib/scrape/robots";

const AGENT = "SprintoOutboundBot";
const ok = (txt: string, path: string) => robotsAllows(parseRobots(txt), AGENT, path);

describe("robots.txt rules", () => {
  it("allows everything when there are no rules", () => {
    expect(ok("", "/anything")).toBe(true);
    expect(robotsAllows(ALLOW_ALL, AGENT, "/x")).toBe(true);
  });

  it("applies the * group when no group names us", () => {
    const txt = "User-agent: *\nDisallow: /private\n";
    expect(ok(txt, "/private/a")).toBe(false);
    expect(ok(txt, "/public")).toBe(true);
  });

  it("prefers a group that names our bot over *", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: SprintoOutboundBot\nDisallow: /secret\n";
    expect(ok(txt, "/pricing")).toBe(true);
    expect(ok(txt, "/secret")).toBe(false);
  });

  it("matches our name case-insensitively", () => {
    expect(ok("User-agent: sprintooutboundbot\nDisallow: /\n", "/x")).toBe(false);
  });

  it("lets the longest matching rule win, and Allow win a tie", () => {
    const txt = "User-agent: *\nDisallow: /docs\nAllow: /docs/public\n";
    expect(ok(txt, "/docs/internal")).toBe(false);
    expect(ok(txt, "/docs/public/page")).toBe(true);
    expect(ok("User-agent: *\nDisallow: /a\nAllow: /a\n", "/a")).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    expect(ok("User-agent: *\nDisallow:\n", "/x")).toBe(true);
  });

  it("supports * wildcards and the $ end anchor", () => {
    const txt = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*/cache\n";
    expect(ok(txt, "/files/a.pdf")).toBe(false);
    expect(ok(txt, "/files/a.pdf?x=1")).toBe(true);
    expect(ok(txt, "/tmp/u1/cache")).toBe(false);
    expect(ok(txt, "/tmp/u1/other")).toBe(true);
  });

  it("shares rules across stacked User-agent lines, and ignores comments and junk lines", () => {
    const txt = "# hello\nUser-agent: googlebot\nUser-agent: SprintoOutboundBot # us\nDisallow: /x # no\nnonsense line\nCrawl-delay: 10\n";
    expect(ok(txt, "/x")).toBe(false);
    expect(ok(txt, "/y")).toBe(true);
  });

  it("does not treat regex characters in a rule as regex", () => {
    expect(ok("User-agent: *\nDisallow: /a.b\n", "/aXb")).toBe(true);
    expect(ok("User-agent: *\nDisallow: /a.b\n", "/a.b")).toBe(false);
    expect(ok("User-agent: *\nDisallow: /(x)\n", "/(x)")).toBe(false);
  });
});

describe("robots.txt HTTP handling", () => {
  it("parses a 2xx body, allows all on a 4xx, and blocks all on a server error", () => {
    expect(robotsAllows(robotsFromResponse(200, "User-agent: *\nDisallow: /\n"), AGENT, "/x")).toBe(false);
    expect(robotsAllows(robotsFromResponse(404, ""), AGENT, "/x")).toBe(true);
    expect(robotsAllows(robotsFromResponse(403, ""), AGENT, "/x")).toBe(true);
    expect(robotsAllows(robotsFromResponse(500, ""), AGENT, "/x")).toBe(false);
    expect(robotsAllows(robotsFromResponse(503, ""), AGENT, "/x")).toBe(false);
    expect(robotsAllows(DISALLOW_ALL, AGENT, "/")).toBe(false);
  });

  it("only reads the first 500 KiB", () => {
    const filler = "# pad\n".repeat(100_000);
    expect(ok(`${filler}User-agent: *\nDisallow: /late\n`, "/late")).toBe(true);
  });
});
