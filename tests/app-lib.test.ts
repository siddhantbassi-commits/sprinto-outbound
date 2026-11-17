import { describe, expect, it } from "vitest";
import { ago, LANES, plural, tokens } from "@/lib/app/format";
import { csvCell, csvRow, MAX_ENTRIES, parseList, splitCsvLine } from "@/lib/app/list";

describe("parseList", () => {
  it("reads one per line, comma separated, or with schemes and paths", () => {
    const r = parseList("acme.com\nhttps://www.beta.io/pricing, gamma.co.uk;delta.dev");
    expect(r.valid).toEqual(["acme.com", "beta.io", "gamma.co.uk", "delta.dev"]);
    expect(r.rejected).toEqual([]);
  });

  it("de-duplicates and counts the repeats", () => {
    const r = parseList("acme.com\nACME.com\nwww.acme.com\nbeta.io");
    expect(r.valid).toEqual(["acme.com", "beta.io"]);
    expect(r.duplicates).toBe(2);
  });

  it("rejects what cannot be a public company domain, with the reason", () => {
    const r = parseList("10.0.0.1\nlocalhost\nftp://acme.com\nnot a domain\nacme.com");
    expect(r.valid).toEqual(["acme.com"]);
    expect(r.rejected.map((x) => x.input)).toEqual(expect.arrayContaining(["10.0.0.1", "localhost", "ftp://acme.com"]));
    expect(r.rejected.every((x) => x.problem.length > 0)).toBe(true);
  });

  it("uses the named column when the CSV has a header", () => {
    const r = parseList('Company,Website,Notes\nAcme,acme.com,"big, important"\nBeta,https://beta.io,\n');
    expect(r.valid).toEqual(["acme.com", "beta.io"]);
    expect(r.rejected).toEqual([]);
  });

  it("does not treat company names as domains when a column is named", () => {
    expect(parseList("name,domain\nAcme Inc,acme.com").valid).toEqual(["acme.com"]);
  });

  it("copes with empty input, blank lines and Windows line endings", () => {
    expect(parseList("")).toEqual({ valid: [], rejected: [], duplicates: 0, truncated: false });
    expect(parseList("\r\n\r\nacme.com\r\n\r\n").valid).toEqual(["acme.com"]);
  });

  it("caps the list and says it was cut", () => {
    const many = Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => `site${i}.com`).join("\n");
    const r = parseList(many);
    expect(r.valid).toHaveLength(MAX_ENTRIES);
    expect(r.truncated).toBe(true);
  });

  it("does not choke on hostile input", () => {
    const r = parseList('=HYPERLINK("http://evil.com")\n@SUM(A1)\n"unterminated\nacme.com');
    expect(r.valid).toEqual(["acme.com"]);
    expect(r.rejected.length).toBeGreaterThan(0);
  });
});

describe("splitCsvLine", () => {
  it("honours quotes and escaped quotes", () => {
    expect(splitCsvLine('a,"b,c","d ""e"""')).toEqual(["a", "b,c", 'd "e"']);
  });
});

describe("csvCell (spreadsheet formula injection)", () => {
  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralises a cell that starts with %j", (v) => {
    expect(csvCell(v)).toMatch(/^"'/);
  });

  it("quotes every cell, doubles quotes and flattens line breaks", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line one\nline two")).toBe('"line one line two"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });

  it("leaves an ordinary value alone and builds a row", () => {
    expect(csvCell("acme.com")).toBe('"acme.com"');
    expect(csvRow(["a", 1, "=x"])).toBe(`"a","1","'=x"`);
  });
});

describe("format", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  it("says how long ago, in words", () => {
    expect(ago("2026-11-04T11:59:50Z", now)).toBe("just now");
    expect(ago("2026-11-04T11:59:00Z", now)).toBe("a minute ago");
    expect(ago("2026-11-04T11:30:00Z", now)).toBe("30 minutes ago");
    expect(ago("2026-11-04T09:00:00Z", now)).toBe("3 hours ago");
    expect(ago("2026-11-01T12:00:00Z", now)).toBe("3 days ago");
    expect(ago(null, now)).toBe("never");
    expect(ago("nonsense", now)).toBe("unknown");
  });
  it("covers every lane the database allows, with plain wording", () => {
    for (const lane of ["active", "not_fit", "needs_more", "review", "no_contact", "held", "skipped", "sent", "unknown", "failed"]) expect(LANES[lane]?.help.length, lane).toBeGreaterThan(10);
  });
  it("pluralises and shortens", () => {
    expect(plural(1, "domain")).toBe("1 domain");
    expect(plural(3, "domain")).toBe("3 domains");
    expect(tokens(2820)).toBe("2.8k");
    expect(tokens(40)).toBe("40");
    expect(tokens(null)).toBe("");
  });
});
