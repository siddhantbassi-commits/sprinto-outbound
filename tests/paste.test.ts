import { describe, expect, it } from "vitest";
import { cleanPaste } from "@/lib/app/paste";

describe("cleanPaste", () => {
  it("reads plain lines, addresses and paths the same way as the server", () => {
    const r = cleanPaste("acme.com\nhttps://www.beta.io/pricing, gamma.co.uk;delta.dev");
    expect(r.domains).toEqual(["acme.com", "beta.io", "gamma.co.uk", "delta.dev"]);
    expect(r.unclear).toEqual([]);
  });

  it("finds domains inside sentences, bullets, numbering and markdown", () => {
    const r = cleanPaste("1. Acme Inc – acme.com\n• Beta (https://beta.io/about)\n- [Gamma](https://gamma.co.uk)\nSee also: delta.dev.");
    expect(r.domains).toEqual(["acme.com", "beta.io", "gamma.co.uk", "delta.dev"]);
  });

  it("takes the domain from an email address and counts how many", () => {
    const r = cleanPaste("Ananya Rao <ananya@northwind.io>, mailto:sam@orbit.dev\nhttps://northwind.io");
    expect(r.domains).toEqual(["northwind.io", "orbit.dev"]);
    expect(r.fromEmails).toBe(2);
    expect(r.duplicates).toBe(1);
  });

  it("uses what follows the last @ when an address contains more than one", () => {
    expect(cleanPaste("odd@name@acme.com").domains).toEqual(["acme.com"]);
  });

  it("folds repeats, ignores case, www and ports", () => {
    const r = cleanPaste("ACME.com\nwww.acme.com\nhttp://acme.com:8080/x?y=1\nbeta.io");
    expect(r.domains).toEqual(["acme.com", "beta.io"]);
    expect(r.duplicates).toBe(2);
  });

  it("ignores plain words such as company names, and says what looked like an address but could not be one", () => {
    const r = cleanPaste("Acme Inc\nftp://files.acme.com\nacme..com\nbeta.io");
    expect(r.domains).toEqual(["beta.io"]);
    expect(r.unclear).toEqual(expect.arrayContaining(["ftp://files.acme.com", "acme..com"]));
  });

  it("never turns an IP address, a number or a formula into a domain", () => {
    const r = cleanPaste("10.0.0.1\n3.14\n=HYPERLINK(\"http://evil.com\")\nacme.com");
    expect(r.domains).not.toContain("10.0.0.1");
    expect(r.domains).not.toContain("3.14");
    expect(r.domains).toContain("acme.com");
  });

  it("reads the named column of a CSV and says so", () => {
    const r = cleanPaste('Company,Website,Notes\nAcme,acme.com,"big, important"\nBeta,https://beta.io,');
    expect(r.csv).toBe(true);
    expect(r.domains).toEqual(["acme.com", "beta.io"]);
  });

  it("copes with empty input and Windows line endings", () => {
    expect(cleanPaste("")).toEqual({ domains: [], fromEmails: 0, duplicates: 0, unclear: [], csv: false });
    expect(cleanPaste("\r\nacme.com\r\n").domains).toEqual(["acme.com"]);
  });
});
