import { describe, expect, it } from "vitest";
import { DEFAULT_BLOCKLIST, isExcludedDomain } from "@/lib/icp/blocklist";
import { companyName } from "@/lib/pitch/company";

describe("companyName", () => {
  it.each([
    ["acme.com", "Acme | Cloud tooling for engineering teams", "Acme"],
    ["acme.com", "Home - Acme", "Acme"],
    ["acme.com", "Acme Cloud – The platform", "Acme Cloud"],
    ["acme.com", "ACME: build faster", "ACME"],
    ["acme.co.uk", "Acme Ltd | Software", "Acme Ltd"],
    ["my-startup.io", "My Startup | Payments", "My Startup"],
    ["acme.com", "Cloud tooling for engineering teams", "Acme"],
    ["acme.com", null, "Acme"],
    ["acme.com", "", "Acme"],
    ["my-startup.io", null, "My Startup"],
    ["zoë.example.com", null, "Example"],
  ])("%s with title %j is %j", (domain, title, expected) => expect(companyName(domain, title)).toBe(expected));

  it("ignores a title segment that is too long to be a name, and one that merely sounds similar", () => {
    expect(companyName("acme.com", `${"Acme ".repeat(20)} | Software`)).toBe("Acme");
    expect(companyName("acme.com", "Acmeless things | Software")).toBe("Acmeless things");
    expect(companyName("ab.io", "Ab | Software")).toBe("Ab");
  });

  it("strips control characters, so a hostile title cannot carry line breaks into an email", () => {
    expect(companyName("acme.com", "Acme\r\nBcc: x@y.co | Software")).not.toMatch(/[\r\n]/);
  });
});

describe("isExcludedDomain", () => {
  it("blocks Sprinto and its competitors, including their subdomains", () => {
    for (const d of DEFAULT_BLOCKLIST) expect(isExcludedDomain(d), d).toBe(true);
    expect(isExcludedDomain("trust.vanta.com")).toBe(true);
    expect(isExcludedDomain("WWW.Drata.com")).toBe(true);
  });

  it("does not block a lookalike or an ordinary company", () => {
    expect(isExcludedDomain("notvanta.com")).toBe(false);
    expect(isExcludedDomain("vanta.com.evil.io")).toBe(false);
    expect(isExcludedDomain("acme.com")).toBe(false);
  });

  it("adds the ICP version's own blocklist", () => {
    expect(isExcludedDomain("customer.io", ["customer.io"])).toBe(true);
    expect(isExcludedDomain("acme.com", ["customer.io"])).toBe(false);
  });
});
