import { describe, expect, it } from "vitest";
import { buildMessage, readMessage } from "@/lib/email/mime";
import { builtInSafeguards, checkSenderDomain, evalDkim, evalDmarc, evalMx, evalSpf, looksLikeFullAddress, recommendedDailyCap, senderDomain, setupChecks, verdictOf, type SetupFacts } from "@/lib/golive/checks";
import { dnsChecks, type Resolver } from "@/lib/golive/dns-core";

const rec = (...s: string[]) => s.map((x) => [x]);

describe("SPF", () => {
  it("fails with no record, and fails with two (which cancels both)", () => {
    expect(evalSpf([], "acme.io").status).toBe("fail");
    expect(evalSpf(rec("v=spf1 include:_spf.google.com ~all", "v=spf1 -all"), "acme.io")).toMatchObject({ status: "fail", detail: expect.stringMatching(/2 SPF records/) });
  });
  it("passes a normal record, with ~all or -all", () => {
    expect(evalSpf(rec("v=spf1 include:_spf.google.com ~all"), "acme.io").status).toBe("pass");
    expect(evalSpf(rec("v=spf1 include:_spf.google.com -all"), "acme.io").detail).toMatch(/rejects/);
  });
  it("warns when it ends without saying what to do, or names no sender", () => {
    expect(evalSpf(rec("v=spf1 include:_spf.google.com"), "acme.io").status).toBe("warn");
    expect(evalSpf(rec("v=spf1 include:_spf.google.com ?all"), "acme.io").status).toBe("warn");
    expect(evalSpf(rec("v=spf1 ~all"), "acme.io").status).toBe("warn");
  });
  it("reads a record that DNS split into several strings, and ignores unrelated TXT records", () => {
    expect(evalSpf([["v=spf1 include:_spf.goo", "gle.com ~all"], ["google-site-verification=abc"]], "acme.io").status).toBe("pass");
  });
});

describe("DMARC", () => {
  it("fails with no record or no policy", () => {
    expect(evalDmarc([], "acme.io").status).toBe("fail");
    expect(evalDmarc(rec("v=DMARC1; rua=mailto:x@acme.io"), "acme.io").status).toBe("fail");
  });
  it("warns while it only monitors, passes once it acts, warns if it applies to part of the mail", () => {
    expect(evalDmarc(rec("v=DMARC1; p=none"), "acme.io").status).toBe("warn");
    expect(evalDmarc(rec("v=DMARC1; p=quarantine"), "acme.io").status).toBe("pass");
    expect(evalDmarc(rec("v=DMARC1; p=reject; pct=100"), "acme.io").status).toBe("pass");
    expect(evalDmarc(rec("v=DMARC1; p=reject; pct=20"), "acme.io").status).toBe("warn");
  });
});

describe("DKIM and the mail servers", () => {
  it("passes when a key is published, warns (not fails) when the selector is not found", () => {
    expect(evalDkim(rec("v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"), "acme.io", "google").status).toBe("pass");
    expect(evalDkim([], "acme.io", "google")).toMatchObject({ status: "warn", detail: expect.stringMatching(/different selector/) });
    expect(evalDkim(rec("v=DKIM1; k=rsa; p="), "acme.io", "google").status).toBe("warn");
  });
  it("needs at least one mail server so replies and bounces have somewhere to go", () => {
    expect(evalMx([{ exchange: "aspmx.l.google.com" }], "acme.io").status).toBe("pass");
    expect(evalMx([], "acme.io").status).toBe("fail");
  });
});

describe("the sending address", () => {
  it("finds the domain, and fails a personal mailbox, which cannot carry the domain's own authentication", () => {
    expect(senderDomain("Ana <ana@Acme.IO>".replace(/.*<|>/g, ""))).toBe("acme.io");
    expect(senderDomain("not an address")).toBeNull();
    expect(checkSenderDomain("me@gmail.com").status).toBe("fail");
    expect(checkSenderDomain("me@pg27.mesaschool.co").status).toBe("pass");
    expect(checkSenderDomain(null).status).toBe("fail");
  });

  it("looks up the four records for a company domain, and none for a personal one", async () => {
    const asked: string[] = [];
    const r: Resolver = { txt: async (n) => (asked.push(n), n.startsWith("_dmarc") ? rec("v=DMARC1; p=reject") : n.startsWith("google._domainkey") ? rec("v=DKIM1; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA") : rec("v=spf1 include:_spf.google.com ~all")), mx: async () => [{ exchange: "mx.acme.io" }] };
    const c = await dnsChecks("a@acme.io", r);
    expect(c.map((x) => x.id)).toEqual(["spf", "dkim", "dmarc", "mx"]);
    expect(c.every((x) => x.status === "pass")).toBe(true);
    expect(asked.sort()).toEqual(["_dmarc.acme.io", "acme.io", "google._domainkey.acme.io"]);
    expect(await dnsChecks("a@gmail.com", r)).toEqual([]);
    expect(await dnsChecks(null, r)).toEqual([]);
  });
});

describe("the postal address", () => {
  it("accepts a real one and refuses a postcode alone, a placeholder, or something too short", () => {
    expect(looksLikeFullAddress("12 Demo Street, Mumbai 400001")).toBe(true);
    expect(looksLikeFullAddress("Sprinto, 100 Example Street, Bengaluru 560001, India")).toBe(true);
    expect(looksLikeFullAddress("600020")).toBe(false);
    expect(looksLikeFullAddress("[postal address]")).toBe(false);
    expect(looksLikeFullAddress("Mumbai")).toBe(false);
    expect(looksLikeFullAddress("12 Road, Mumbai")).toBe(false); // a number and a place, but not enough to find a door
    expect(looksLikeFullAddress("Street Mumbai India x")).toBe(false);
    expect(looksLikeFullAddress(null)).toBe(false);
  });
});

describe("the daily ramp", () => {
  const NOW = Date.parse("2026-11-18T00:00:00Z");
  const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
  it("starts small and climbs each week", () => {
    expect(recommendedDailyCap(null, NOW)).toBe(10);
    expect(recommendedDailyCap(ago(3), NOW)).toBe(10);
    expect(recommendedDailyCap(ago(7), NOW)).toBe(25);
    expect(recommendedDailyCap(ago(14), NOW)).toBe(50);
    expect(recommendedDailyCap(ago(21), NOW)).toBe(100);
    expect(recommendedDailyCap(ago(60), NOW)).toBe(200);
  });
});

describe("the setup checks", () => {
  const good: SetupFacts = { testTo: "me@acme.io", fromAddress: "me@acme.io", postalAddress: "12 Demo Street, Mumbai 400001", senderName: "Ana", senderTitle: "Growth Lead", verifiedClaims: 2, icpSigned: true, approvalRequired: true, dailyCap: 10, cooldownDays: 30, firstSendAt: null, suppressions: 3, outcomesRecorded: 1, gmailConnected: true, workerRecent: true, now: Date.parse("2026-11-18T00:00:00Z") };
  const by = (f: SetupFacts) => Object.fromEntries(setupChecks(f).map((c) => [c.id, c.status]));

  it("passes when everything is in place", () => {
    expect(Object.values(by(good)).every((s) => s === "pass")).toBe(true);
  });
  it("fails each thing that is missing, and says what to do", () => {
    expect(by({ ...good, postalAddress: "600020" }).address).toBe("fail");
    expect(by({ ...good, senderName: "[sender first name]" })["sender-name"]).toBe("fail");
    expect(by({ ...good, verifiedClaims: 0 }).claims).toBe("fail");
    expect(by({ ...good, icpSigned: false }).icp).toBe("fail");
    expect(by({ ...good, gmailConnected: false }).gmail).toBe("fail");
    expect(setupChecks({ ...good, postalAddress: "600020" }).find((c) => c.id === "address")!.fix).toMatch(/Settings/);
  });
  it("warns, not fails, about a stopped worker, approval being off, and a cap above the ramp", () => {
    expect(by({ ...good, workerRecent: false }).worker).toBe("warn");
    expect(by({ ...good, approvalRequired: false }).approval).toBe("warn");
    expect(by({ ...good, dailyCap: 20 }).ramp).toBe("warn");
    expect(by({ ...good, dailyCap: null }).ramp).toBe("warn");
  });
  it("lets the cap grow as the sender ages", () => {
    expect(by({ ...good, dailyCap: 20, firstSendAt: "2026-11-05T00:00:00Z" }).ramp).toBe("pass");
  });
  it("lists the safeguards that are built in, naming the real test address", () => {
    const g = builtInSafeguards(good);
    expect(g.length).toBeGreaterThanOrEqual(7);
    expect(g[0]!.detail).toContain("me@acme.io");
    expect(g.map((x) => x.label).join(" ")).toMatch(/unsubscribe/i);
  });
});

describe("the verdict", () => {
  const c = (status: "pass" | "warn" | "fail") => ({ id: status, label: status, status, detail: "" });
  it("counts what to fix and what to look at, and is ready only with nothing to fix", () => {
    expect(verdictOf([c("pass"), c("pass")])).toMatchObject({ ready: true, fails: 0, warns: 0, headline: "Everything checked is in place" });
    expect(verdictOf([c("pass"), c("warn")])).toMatchObject({ ready: true, headline: "Ready, with 1 thing worth a look" });
    expect(verdictOf([c("fail"), c("fail"), c("warn")])).toMatchObject({ ready: false, fails: 2, headline: "2 things to fix before going live" });
  });
});

describe("the unsubscribe header", () => {
  const base = { from: "me@acme.io", to: "me@acme.io", subject: "S", body: "Dear A,\n\nText.", runId: "run_1", date: new Date("2026-11-18T10:00:00Z") };
  it("is added when an unsubscribe address is given, as a mailto with a subject, and not otherwise", () => {
    const head = (extra: object) => readMessage(buildMessage({ ...base, ...extra })).head;
    expect(head({ unsubscribe: "me@acme.io" })).toContain("List-Unsubscribe: <mailto:me@acme.io?subject=unsubscribe>");
    expect(head({})).not.toContain("List-Unsubscribe");
  });
  it("is the same in a multipart message, and refuses anything that is not one plain address", () => {
    expect(readMessage(buildMessage({ ...base, html: "<p>x</p>", unsubscribe: "me@acme.io" })).head).toContain("List-Unsubscribe: <mailto:me@acme.io?subject=unsubscribe>");
    expect(() => buildMessage({ ...base, unsubscribe: "a@b.io>\r\nBcc: x@y.io" })).toThrow(/single plain email/);
  });
});
