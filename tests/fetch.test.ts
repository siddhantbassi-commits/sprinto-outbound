import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchError, nodeTransport, safeFetch } from "@/lib/scrape/fetch";
import { GuardError } from "@/lib/scrape/url-guard";
import { fakeWeb, page, redirect } from "./fakeweb";

describe("safeFetch: the guard runs before and between requests", () => {
  it("connects to the address the guard approved, not a second lookup", async () => {
    const web = fakeWeb({ "https://acme.com/": page("<p>hi</p>") }, { dns: { "acme.com": ["93.184.216.34", "93.184.216.35"] } });
    await safeFetch("https://acme.com/", web.deps);
    expect(web.calls[0]?.address).toBe("93.184.216.34");
  });

  it("sends the bot's user agent", async () => {
    const web = fakeWeb({ "https://acme.com/": page("<p>hi</p>") });
    await safeFetch("https://acme.com/", web.deps);
    expect(web.calls[0]?.headers["User-Agent"]).toMatch(/^SprintoOutboundBot\/1\.0 \(\+mailto:/);
  });

  it.each([
    ["a private address", { "intranet.acme.com": ["10.0.0.5"] }],
    ["the cloud metadata address", { "intranet.acme.com": ["169.254.169.254"] }],
    ["loopback", { "intranet.acme.com": ["127.0.0.1"] }],
    ["IPv6 loopback", { "intranet.acme.com": ["::1"] }],
    ["one private address among public ones", { "intranet.acme.com": ["93.184.216.34", "192.168.1.1"] }],
    ["no answer at all", { "intranet.acme.com": [] }],
  ])("refuses a host that resolves to %s, without making a request", async (_name, dns) => {
    const web = fakeWeb({}, { dns });
    await expect(safeFetch("https://intranet.acme.com/", web.deps)).rejects.toBeInstanceOf(GuardError);
    expect(web.calls).toHaveLength(0);
  });

  it.each([
    ["a non-web scheme", "file:///etc/passwd"],
    ["ftp", "ftp://acme.com/x"],
    ["an odd port", "https://acme.com:6379/"],
    ["a login in the address", "https://user:pass@acme.com/"],
  ])("refuses %s", async (_name, url) => {
    const web = fakeWeb({});
    await expect(safeFetch(url, web.deps)).rejects.toBeInstanceOf(GuardError);
    expect(web.calls).toHaveLength(0);
  });

  it("allows the standard ports", async () => {
    const web = fakeWeb({ "https://acme.com/": page("<p>x</p>"), "http://acme.com/": page("<p>y</p>") });
    await expect(safeFetch("https://acme.com:443/", web.deps)).resolves.toMatchObject({ status: 200 });
    await expect(safeFetch("http://acme.com:80/", web.deps)).resolves.toMatchObject({ status: 200 });
  });

  it("rejects a bad URL with a clear error", async () => {
    await expect(safeFetch("not a url", fakeWeb({}).deps)).rejects.toMatchObject({ code: "bad_url" });
  });
});

describe("safeFetch: redirects", () => {
  it("follows a redirect on the same registered domain and reports the final address", async () => {
    const web = fakeWeb({ "https://acme.com/": redirect("https://www.acme.com/"), "https://www.acme.com/": page("<p>home</p>") });
    const res = await safeFetch("https://acme.com/", web.deps);
    expect(res.url).toBe("https://www.acme.com/");
    expect(res.redirects).toBe(1);
  });

  it("follows relative redirects", async () => {
    const web = fakeWeb({ "https://acme.com/old": redirect("/new", 302), "https://acme.com/new": page("<p>n</p>") });
    expect((await safeFetch("https://acme.com/old", web.deps)).url).toBe("https://acme.com/new");
  });

  it("refuses a redirect to another company's domain", async () => {
    const web = fakeWeb({ "https://acme.com/": redirect("https://evil.com/") });
    await expect(safeFetch("https://acme.com/", web.deps)).rejects.toBeInstanceOf(GuardError);
    expect(web.urls()).toEqual(["https://acme.com/"]);
  });

  it("refuses a lookalike domain that merely ends the same way", async () => {
    const web = fakeWeb({ "https://acme.com/": redirect("https://notacme.com/") });
    await expect(safeFetch("https://acme.com/", web.deps)).rejects.toBeInstanceOf(GuardError);
  });

  it("refuses a redirect to a metadata address, a private host, or a non-web scheme", async () => {
    for (const target of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "file:///etc/passwd", "gopher://acme.com/"]) {
      const web = fakeWeb({ "https://acme.com/": redirect(target) });
      await expect(safeFetch("https://acme.com/", web.deps)).rejects.toBeInstanceOf(GuardError);
      expect(web.calls).toHaveLength(1);
    }
  });

  it("refuses a same-domain redirect whose host resolves privately (DNS pointed inward)", async () => {
    const web = fakeWeb({ "https://acme.com/": redirect("https://internal.acme.com/") }, { dns: { "internal.acme.com": ["10.1.2.3"] } });
    await expect(safeFetch("https://acme.com/", web.deps)).rejects.toBeInstanceOf(GuardError);
    expect(web.calls).toHaveLength(1);
  });

  it("refuses a redirect to an odd port on the same domain", async () => {
    const web = fakeWeb({ "https://acme.com/": redirect("https://acme.com:8443/admin") });
    await expect(safeFetch("https://acme.com/", web.deps)).rejects.toBeInstanceOf(GuardError);
  });

  it("stops a redirect loop", async () => {
    const web = fakeWeb({ "https://acme.com/a": redirect("/b"), "https://acme.com/b": redirect("/a") });
    await expect(safeFetch("https://acme.com/a", web.deps)).rejects.toMatchObject({ code: "too_many_redirects" });
    expect(web.calls.length).toBeLessThanOrEqual(5);
  });

  it("returns a redirect that has no Location header as an ordinary response", async () => {
    const web = fakeWeb({ "https://acme.com/": { status: 302, body: "" } });
    await expect(safeFetch("https://acme.com/", web.deps)).resolves.toMatchObject({ status: 302 });
  });
});

describe("safeFetch: what comes back", () => {
  it("returns a non-2xx status without a body and without throwing", async () => {
    const web = fakeWeb({ "https://acme.com/x": { status: 404, body: "Not here", type: "text/html" } });
    expect(await safeFetch("https://acme.com/x", web.deps)).toMatchObject({ status: 404, body: "" });
  });

  it("refuses a 200 that is not a web page", async () => {
    const web = fakeWeb({ "https://acme.com/f.pdf": { type: "application/pdf", body: "%PDF" }, "https://acme.com/api": { type: "application/json", body: "{}" } });
    await expect(safeFetch("https://acme.com/f.pdf", web.deps)).rejects.toMatchObject({ code: "wrong_type" });
    await expect(safeFetch("https://acme.com/api", web.deps)).rejects.toMatchObject({ code: "wrong_type" });
  });

  it("accepts a page with no content type if it looks like HTML", async () => {
    const web = fakeWeb({ "https://acme.com/": { type: "", body: "<!doctype html><p>hi</p>" } });
    expect((await safeFetch("https://acme.com/", web.deps)).body).toContain("hi");
  });

  it("reads text for robots.txt and sitemaps", async () => {
    const web = fakeWeb({ "https://acme.com/robots.txt": { type: "text/plain", body: "User-agent: *" }, "https://acme.com/sitemap.xml": { type: "application/xml", body: "<urlset/>" } });
    expect((await safeFetch("https://acme.com/robots.txt", web.deps, { accept: "text" })).body).toBe("User-agent: *");
    expect((await safeFetch("https://acme.com/sitemap.xml", web.deps, { accept: "text" })).body).toBe("<urlset/>");
  });

  it("decodes the declared charset", async () => {
    const web = fakeWeb({});
    web.deps.transport = async () => ({ status: 200, headers: { "content-type": "text/html; charset=iso-8859-1" }, body: Buffer.from([0x63, 0x61, 0x66, 0xe9]), truncated: false });
    expect((await safeFetch("https://acme.com/", web.deps)).body).toBe("café");
  });

  it("falls back to UTF-8 for a charset it does not know", async () => {
    const web = fakeWeb({});
    web.deps.transport = async () => ({ status: 200, headers: { "content-type": "text/html; charset=bogus-9" }, body: Buffer.from("ok", "utf8"), truncated: false });
    expect((await safeFetch("https://acme.com/", web.deps)).body).toBe("ok");
  });

  it("passes the remaining time budget to the transport, shrinking across redirects", async () => {
    const web = fakeWeb({ "https://acme.com/": { ...redirect("/b"), delayMs: 30 }, "https://acme.com/b": page("<p>x</p>") });
    await safeFetch("https://acme.com/", web.deps, { timeoutMs: 1000 });
    expect(web.calls[0]!.timeoutMs).toBeLessThanOrEqual(1000);
    expect(web.calls[1]!.timeoutMs).toBeLessThan(web.calls[0]!.timeoutMs);
  });

  it("fails with a timeout when the budget is already spent", async () => {
    const web = fakeWeb({ "https://acme.com/": { ...redirect("/b"), delayMs: 40 }, "https://acme.com/b": page("<p>x</p>") });
    await expect(safeFetch("https://acme.com/", web.deps, { timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("nodeTransport against a real local server", () => {
  let server: http.Server;
  let port = 0;
  const seen: { host?: string; encoding?: string; ua?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ host: req.headers.host, encoding: req.headers["accept-encoding"] as string, ua: req.headers["user-agent"] });
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("a".repeat(50_000));
      } else if (req.url === "/hang") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("partial");
      } else if (req.url === "/redir") {
        res.writeHead(302, { location: "http://169.254.169.254/" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<p>hello</p>");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const req = (path: string, extra: Partial<Parameters<typeof nodeTransport>[0]> = {}) =>
    nodeTransport({ url: new URL(`http://pinned.example.test:${port}${path}`), address: "127.0.0.1", headers: { "User-Agent": "T/1" }, timeoutMs: 2000, maxBytes: 1_000_000, ...extra });

  it("connects to the pinned address whatever the name would resolve to, and keeps the Host header", async () => {
    const res = await req("/");
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("<p>hello</p>");
    expect(seen.at(-1)?.host).toBe(`pinned.example.test:${port}`);
  });

  it("asks for an uncompressed body, so a compression bomb cannot arrive", async () => {
    await req("/");
    expect(seen.at(-1)?.encoding).toBe("identity");
    expect(seen.at(-1)?.ua).toBe("T/1");
  });

  it("stops reading at the size cap and says it was cut", async () => {
    const res = await req("/big", { maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1000);
  });

  it("does not follow redirects itself", async () => {
    const res = await req("/redir");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://169.254.169.254/");
  });

  it("gives up on a server that stalls", async () => {
    await expect(req("/hang", { timeoutMs: 150 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports a refused connection as a network error", async () => {
    const closed = await new Promise<number>((resolve) => {
      const s = http.createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    await expect(nodeTransport({ url: new URL(`http://x.example.test:${closed}/`), address: "127.0.0.1", headers: {}, timeoutMs: 1000, maxBytes: 10 })).rejects.toBeInstanceOf(FetchError);
  });
});
