import { describe, expect, it } from "vitest";
import { assertPublicHost, checkRedirect, GuardError, isBlockedIp, normaliseDomain, registrableDomain, sameSite } from "@/lib/scrape/url-guard";

describe("isBlockedIp", () => {
  const blocked = [
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fe80::1%eth0", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.5", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a00:1", "64:ff9b::7f00:1",
    "not-an-ip", "", "999.1.1.1",
  ];
  it.each(blocked)("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
  it.each(allowed)("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("normaliseDomain", () => {
  it.each([
    ["acme.com", "acme.com"],
    ["  ACME.com  ", "acme.com"],
    ["https://www.acme.com/pricing?x=1#y", "acme.com"],
    ["http://acme.com:8080/", "acme.com"],
    ["user:pass@acme.com", "acme.com"],
    ["acme.co.uk", "acme.co.uk"],
    ["acme.com.", "acme.com"],
    ["bücher.de", "xn--bcher-kva.de"],
  ])("accepts %s", (input, domain) => expect(normaliseDomain(input)).toEqual({ ok: true, domain }));

  it.each([
    "", "   ", "localhost", "127.0.0.1", "2130706433", "0x7f.1", "017700000001", "[::1]", "http://[::1]/", "192.168.1.1",
    "intranet", "foo.local", "foo.internal", "foo.localhost", "ftp://acme.com", "file:///etc/passwd", "javascript:alert(1)",
    "acme com", "-bad.com", "bad-.com", "a..b.com", "acme.123", "metadata.google.internal", "a".repeat(64) + ".com",
    "a.b", "acme.c", "acme.1a", "acme.-x", "acme.x-",
  ])("rejects %j", (input) => expect(normaliseDomain(input).ok).toBe(false));

  it("gives a reason", () => {
    expect(normaliseDomain("127.0.0.1")).toEqual({ ok: false, reason: "An IP address is not a company domain" });
    expect(normaliseDomain("ftp://acme.com")).toMatchObject({ ok: false });
  });
});

describe("same-site checks", () => {
  it("finds the registrable domain", () => {
    expect(registrableDomain("www.acme.com")).toBe("acme.com");
    expect(registrableDomain("a.b.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("acme.com")).toBe("acme.com");
  });
  it("compares owners", () => {
    expect(sameSite("www.acme.com", "trust.acme.com")).toBe(true);
    expect(sameSite("acme.com", "acme.com.evil.io")).toBe(false);
    expect(sameSite("acme.co.uk", "evil.co.uk")).toBe(false);
  });
});

describe("DNS and redirect guards", () => {
  const dns = (table: Record<string, string[]>) => async (host: string) => table[host] ?? [];

  it("accepts a public host and returns its addresses to connect to", async () => {
    expect(await assertPublicHost("acme.com", dns({ "acme.com": ["93.184.216.34"] }))).toEqual(["93.184.216.34"]);
  });
  it("refuses a host that points inside", async () => {
    await expect(assertPublicHost("evil.com", dns({ "evil.com": ["127.0.0.1"] }))).rejects.toBeInstanceOf(GuardError);
  });
  it("refuses if any one address is private (DNS answers with a mix)", async () => {
    await expect(assertPublicHost("mix.com", dns({ "mix.com": ["8.8.8.8", "10.0.0.1"] }))).rejects.toThrow(/private/);
  });
  it("refuses an unresolvable host", async () => {
    await expect(assertPublicHost("nope.com", dns({}))).rejects.toThrow(/did not resolve/);
  });

  const table = { "acme.com": ["93.184.216.34"], "www.acme.com": ["93.184.216.34"], "trust.acme.com": ["10.0.0.9"] };
  it("follows a same-site public redirect", async () => {
    const u = await checkRedirect("acme.com", "https://www.acme.com/home", "https://acme.com/", dns(table));
    expect(u.hostname).toBe("www.acme.com");
  });
  it("follows a relative redirect", async () => {
    const u = await checkRedirect("acme.com", "/pricing", "https://acme.com/", dns(table));
    expect(u.pathname).toBe("/pricing");
  });
  it("refuses a redirect to another company", async () => {
    await expect(checkRedirect("acme.com", "https://evil.com/", "https://acme.com/", dns(table))).rejects.toThrow(/left the company/);
  });
  it("refuses a redirect to a non-http scheme", async () => {
    await expect(checkRedirect("acme.com", "file:///etc/passwd", "https://acme.com/", dns(table))).rejects.toThrow(/refused/);
  });
  it("refuses a same-site redirect whose host resolves privately", async () => {
    await expect(checkRedirect("acme.com", "https://trust.acme.com/", "https://acme.com/", dns(table))).rejects.toThrow(/private/);
  });
  it("refuses a redirect that is not a URL", async () => {
    await expect(checkRedirect("acme.com", "http://", "https://acme.com/", dns(table))).rejects.toBeInstanceOf(GuardError);
  });
});
