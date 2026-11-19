import { describe, expect, it } from "vitest";
import { codeHash, makeToken, maskAddress, newCode, normaliseAddress, normaliseCode, readToken, reviewerKey } from "@/lib/app/reviewer";

const key = reviewerKey({ cron: "c".repeat(32), gmailSecret: null })!;
const NOW = Date.parse("2026-11-19T10:00:00Z");

describe("reviewer key", () => {
  it("comes from a server secret, and is absent when there is none", () => {
    expect(key).toBeInstanceOf(Buffer);
    expect(reviewerKey({ cron: null, gmailSecret: null })).toBeNull();
    expect(reviewerKey({ cron: "short", gmailSecret: "tiny" })).toBeNull();
    expect(reviewerKey({ cron: null, gmailSecret: "g".repeat(20) })).toBeInstanceOf(Buffer);
  });
  it("differs per secret", () => {
    expect(reviewerKey({ cron: "d".repeat(32), gmailSecret: null })!.equals(key)).toBe(false);
  });
});

describe("addresses and codes", () => {
  it("accepts one plain address and lower-cases it", () => {
    expect(normaliseAddress("  Prof@School.EDU ")).toBe("prof@school.edu");
  });
  it.each(["", "no-at-sign", "a@b", "Name <a@b.com>", "a@b.com, c@d.com", "a@b.com\nbcc: x@y.com", "a b@c.com", "a..b@c.com", ".a@c.com"])("refuses %j", (s) => {
    expect(normaliseAddress(s)).toBeNull();
  });
  it("refuses a non-string", () => {
    expect(normaliseAddress(42)).toBeNull();
    expect(normaliseAddress(null)).toBeNull();
  });
  it("makes six-digit codes", () => {
    for (let i = 0; i < 200; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });
  it("cleans what the reviewer types", () => {
    expect(normaliseCode(" 123 456 ")).toBe("123456");
    expect(normaliseCode("123-456")).toBe("123456");
    expect(normaliseCode("12345")).toBeNull();
    expect(normaliseCode("1234567")).toBeNull();
    expect(normaliseCode("12a456")).toBeNull();
  });
  it("hashes to 64 hex, bound to the address, the code and the key", () => {
    const h = codeHash(key, "a@b.com", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHash(key, "a@b.com", "123456")).toBe(h);
    expect(codeHash(key, "a@b.com", "123457")).not.toBe(h);
    expect(codeHash(key, "x@b.com", "123456")).not.toBe(h);
    expect(codeHash(reviewerKey({ cron: "z".repeat(32), gmailSecret: null })!, "a@b.com", "123456")).not.toBe(h);
    expect(h).not.toContain("123456");
  });
});

describe("the remembered address", () => {
  const tok = makeToken(key, "prof@school.edu", NOW + 1000);
  it("reads back while it is fresh", () => {
    expect(readToken(key, tok, NOW)).toBe("prof@school.edu");
  });
  it("expires", () => {
    expect(readToken(key, tok, NOW + 1000)).toBeNull();
    expect(readToken(key, tok, NOW + 5000)).toBeNull();
  });
  it("cannot be forged by changing the address or the time", () => {
    const [a, exp, sig] = tok.split(".");
    const other = Buffer.from("evil@x.com").toString("base64url");
    expect(readToken(key, `${other}.${exp}.${sig}`, NOW)).toBeNull();
    expect(readToken(key, `${a}.${Number(exp) + 99999999}.${sig}`, NOW)).toBeNull();
    expect(readToken(key, `${a}.${exp}.${"A".repeat(sig!.length)}`, NOW)).toBeNull();
  });
  it("is not honoured under another key, or when missing or damaged", () => {
    expect(readToken(reviewerKey({ cron: "z".repeat(32), gmailSecret: null })!, tok, NOW)).toBeNull();
    expect(readToken(key, undefined, NOW)).toBeNull();
    expect(readToken(key, "", NOW)).toBeNull();
    expect(readToken(key, "a.b", NOW)).toBeNull();
    expect(readToken(key, "x".repeat(700), NOW)).toBeNull();
  });
});

describe("masking", () => {
  it("shows enough to recognise, not to read", () => {
    expect(maskAddress("professor@school.edu")).toBe("pr••••••@school.edu");
    expect(maskAddress("ab@x.io")).toBe("ab•••@x.io");
  });
});
