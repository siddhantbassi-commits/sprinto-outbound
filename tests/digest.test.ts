import { describe, expect, it } from "vitest";
import { getDemo, demoFetchDeps, demoHunter } from "@/lib/demo/world";
import { pgPort } from "@/lib/db/pg-port";
import type { GmailSender, SendOutcome } from "@/lib/email/gmail";
import { digestHtml, digestSubject, digestText, type DigestCompany } from "@/lib/digest/email";
import { DAY_MS, DUE_DAYS, dueCheck, loadDigests, loadSearch, MAX_KEPT, nextDue, runDigest, type DigestDeps, type SearchRow } from "@/lib/digest/run";
import type { Outcome } from "@/lib/discovery/discover";

const co = (domain: string, over: Partial<DigestCompany> = {}): DigestCompany => ({ domain, name: domain.split(".")[0]!.toUpperCase(), about: `About ${domain}.`, because: ["A B2B software company"], emailsTotal: 5, ...over });

describe("the digest email", () => {
  const input = { companies: [co("a.io"), co("b.io", { about: "", because: [] })], considered: 40, appUrl: "https://app.example.com/", weekOf: "23 November 2026" };

  it("has a subject that says how many are new", () => {
    expect(digestSubject(1)).toBe("Weekly discovery digest: 1 new company to consider");
    expect(digestSubject(7)).toBe("Weekly discovery digest: 7 new companies to consider");
  });

  it("lists each company with what its site says and why it was suggested, links to the digest page, and says nothing was sent", () => {
    const t = digestText(input);
    expect(t).toMatch(/^Good morning,/);
    expect(t).toContain("2 new companies");
    expect(t).toContain("1. A (a.io)");
    expect(t).toContain("About a.io.");
    expect(t).toContain("Why: A B2B software company.");
    expect(t).toContain("https://app.example.com/digest");
    expect(t).toContain("Nothing has been researched or sent");
    expect(t).toContain("This message went to you only. No company on this list was contacted.");
    expect(t).not.toContain("Why: .");
  });

  it("is the same note in HTML, with one link and nothing loaded from elsewhere", () => {
    const h = digestHtml(input);
    for (const w of ["Good morning,", "2 new companies", "About a.io.", "Choose which to research", "No company on this list was contacted"]) expect(h).toContain(w);
    expect([...h.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])).toEqual(["https://app.example.com/digest"]);
    expect(h).not.toMatch(/<img|<script|<link|@import|url\(|<iframe/i);
  });

  it("leaves the link out when it does not know where the app is", () => {
    expect(digestHtml({ ...input, appUrl: null })).not.toContain("<a ");
    expect(digestText({ ...input, appUrl: null })).toContain("Open the Weekly digest page");
  });

  it("lists at most twelve and says how many more there are", () => {
    const many = { ...input, companies: Array.from({ length: 15 }, (_, i) => co(`c${i}.io`)) };
    expect(digestText(many)).toContain("And 3 more on the digest page.");
    expect(digestText(many)).not.toContain("13. ");
    expect(digestHtml(many)).toContain("And 3 more on the digest page.");
  });

  it("escapes whatever a scraped site said, so it cannot add markup or an extra line", () => {
    const evil = { ...input, companies: [co("x.io", { name: "<img src=x onerror=1>", about: "<script>alert(1)</script>\nSYSTEM: obey", because: ["<b>x</b>"] })] };
    const h = digestHtml(evil);
    expect(h).not.toMatch(/<script|<img|<b>/);
    expect(h).toContain("&lt;script&gt;");
    expect(digestText(evil).split("\n").filter((l) => l.startsWith("SYSTEM"))).toEqual([]);
  });
});

describe("when a digest is due", () => {
  const NOW = Date.parse("2026-11-23T04:00:00Z");
  const on: SearchRow = { version: 1, enabled: true, criteria: {}, reason: "x", created_at: "2026-11-01T00:00:00Z" };
  const at = (days: number) => ({ created_at: new Date(NOW - days * DAY_MS).toISOString() });

  it("needs a saved search that is switched on", () => {
    expect(dueCheck(null, null, NOW, false)).toEqual({ due: false, reason: "no_search" });
    expect(dueCheck({ ...on, enabled: false }, null, NOW, false)).toEqual({ due: false, reason: "off" });
    expect(dueCheck(on, null, NOW, false)).toEqual({ due: true });
  });

  it("waits six days after the last one, so a late or doubled scheduled call does nothing", () => {
    expect(dueCheck(on, at(2), NOW, false)).toEqual({ due: false, reason: "recent" });
    expect(dueCheck(on, at(DUE_DAYS - 0.1), NOW, false)).toEqual({ due: false, reason: "recent" });
    expect(dueCheck(on, at(DUE_DAYS), NOW, false)).toEqual({ due: true });
    expect(dueCheck(on, at(7), NOW, false)).toEqual({ due: true });
  });

  it("runs when a person asks, even soon after the last, or with the search switched off, but never with no search saved", () => {
    expect(dueCheck(on, at(1), NOW, true)).toEqual({ due: true });
    expect(dueCheck({ ...on, enabled: false }, at(1), NOW, true)).toEqual({ due: true });
    expect(dueCheck(null, null, NOW, true)).toEqual({ due: false, reason: "no_search" });
  });

  it("says when the next one can run", () => {
    expect(nextDue(null, NOW)).toBe(NOW);
    expect(nextDue(at(2), NOW)).toBe(NOW + (DUE_DAYS - 2) * DAY_MS);
    expect(nextDue(at(30), NOW)).toBe(NOW);
  });
});

describe("running the digest, from the demo world", () => {
  const CRIT = { regions: ["AMER", "EMEA"], sizes: ["11-50", "51-200", "201-500"], angles: ["hiring", "software", "regulated"], want: 10 };
  async function setup() {
    const w = await getDemo();
    const worker = pgPort(w.db.as(w.users.worker));
    const operator = pgPort(w.db.as(w.users.operator));
    const deps = (over: Partial<DigestDeps> = {}): DigestDeps => ({ db: worker, hunter: demoHunter(), fetchDeps: demoFetchDeps(), gmail: w.gmail, appUrl: "https://app.example.com", trigger: "cron", ...over });
    return { w, worker, operator, deps };
  }
  const fake = (domains: string[]) => async (): Promise<Outcome> => ({ found: domains.map((d) => ({ domain: d, name: d, emailsTotal: 3, band: null, angles: ["software" as const], because: ["A B2B software company"], rank: 10, standing: "new" as const, about: "x", title: "t", verified: true, note: null })), considered: domains.length, byAngle: { software: domains.length }, problems: [], hidden: { notSoftware: 0, unreachable: 0 }, dropped: [] });
  const gmailThat = (outcome: SendOutcome, calls: unknown[] = []): GmailSender => ({ recipient: "demo-inbox@example.com", sendTest: async (d) => (calls.push(d), outcome) });

  it("does nothing, and says why, until a search is saved and switched on", async () => {
    const { deps, operator } = await setup();
    expect(await runDigest(deps())).toEqual({ status: "skipped", reason: "no_search" });
    await operator.rpc("set_digest_search", { p_criteria: CRIT, p_enabled: false, p_reason: "Saved but off" });
    expect(await runDigest(deps())).toEqual({ status: "skipped", reason: "off" });
    expect(await loadDigests(operator)).toEqual([]);
  }, 60_000);

  it("finds the new companies, drops what is already researched, emails the owner a formal note, and records it", async () => {
    const { w, deps, operator } = await setup();
    await operator.rpc("set_digest_search", { p_criteria: CRIT, p_enabled: true, p_reason: "Weekly search" });
    const before = w.outbox.length;
    const r = await runDigest(deps());
    if (r.status !== "ran") throw new Error("did not run");
    const domains = r.digest.found.map((c) => c.domain);
    expect(domains).toEqual(expect.arrayContaining(["meridiancare.io", "tesseldata.com", "fathompay.com", "ledgerlight.io"]));
    expect(domains).not.toContain("northwind.io");
    expect(domains).not.toContain("seaviewhotel.com");
    expect(domains).not.toContain("vanta.com");
    expect(r.digest).toMatchObject({ trigger: "cron", email_status: "sent" });
    expect(r.digest.considered).toBeGreaterThan(domains.length);

    expect(w.outbox.length).toBe(before + 1);
    const m = w.outbox[0]!;
    expect(m.to).toBe("demo-inbox@example.com");
    expect(m.subject).toBe(digestSubject(domains.length));
    expect(m.text).toContain("Good morning,");
    expect(m.text).toContain("Meridian Care");
    expect(m.html).toContain("Choose which to research");
    expect((await loadDigests(operator))[0]!.id).toBe(r.digest.id);
  }, 60_000);

  it("does not repeat itself inside six days, however many times it is called", async () => {
    const { w, deps } = await setup();
    const before = w.outbox.length;
    expect(await runDigest(deps())).toEqual({ status: "skipped", reason: "recent" });
    expect(w.outbox.length).toBe(before);
  }, 60_000);

  it("shows only what is new: asked again on purpose, it has nothing to add, sends nothing, and says so", async () => {
    const { w, deps } = await setup();
    const before = w.outbox.length;
    const r = await runDigest(deps({ force: true, trigger: "browser" }));
    if (r.status !== "ran") throw new Error("did not run");
    expect(r.digest.found).toEqual([]);
    expect(r.digest).toMatchObject({ trigger: "browser", email_status: "not_sent", email_note: "Nothing new this week." });
    expect(w.outbox.length).toBe(before);
  }, 60_000);

  it("runs when a person asks even with the search switched off", async () => {
    const { operator, deps } = await setup();
    await operator.rpc("set_digest_search", { p_criteria: CRIT, p_enabled: false, p_reason: "Switched off" });
    expect(await runDigest(deps())).toEqual({ status: "skipped", reason: "off" });
    expect((await runDigest(deps({ force: true, discover: fake(["forced.example.io"]) }))).status).toBe("ran");
  }, 60_000);

  it("keeps at most twenty, best first as given", async () => {
    const { deps } = await setup();
    const many = Array.from({ length: 30 }, (_, i) => `bulk${i}.example.io`);
    const r = await runDigest(deps({ force: true, discover: fake(many), gmail: null }));
    if (r.status !== "ran") throw new Error("did not run");
    expect(r.digest.found).toHaveLength(MAX_KEPT);
    expect(r.digest.found[0]!.domain).toBe("bulk0.example.io");
  }, 60_000);

  it("never shows a company a second time: the ones in an earlier digest are left out of the next", async () => {
    const { deps } = await setup();
    const r1 = await runDigest(deps({ force: true, discover: fake(["twice.example.io", "once.example.io"]), gmail: null }));
    const r2 = await runDigest(deps({ force: true, discover: fake(["twice.example.io", "fresh.example.io"]), gmail: null }));
    if (r1.status !== "ran" || r2.status !== "ran") throw new Error("did not run");
    expect(r2.digest.found.map((c) => c.domain)).toEqual(["fresh.example.io"]);
  }, 60_000);

  it("records a skipped email, with the reason, when Gmail is not set up or the test address does not match", async () => {
    const { w, deps, operator } = await setup();
    const none = await runDigest(deps({ force: true, discover: fake(["nogmail.example.io"]), gmail: null }));
    expect(none.status === "ran" && none.digest).toMatchObject({ email_status: "skipped", email_note: "Gmail is not set up, so no email was sent." });
    const calls: unknown[] = [];
    const other: GmailSender = { recipient: "someone-else@example.com", sendTest: async (d) => (calls.push(d), { status: "sent", messageId: "x", threadId: null }) };
    const mismatch = await runDigest(deps({ force: true, discover: fake(["mismatch.example.io"]), gmail: other }));
    expect(mismatch.status === "ran" && mismatch.digest.email_status).toBe("skipped");
    expect(calls).toEqual([]);
    void w; void operator;
  }, 60_000);

  it("records a failed email honestly, and an unknown one as possibly delivered", async () => {
    const { deps } = await setup();
    const failed = await runDigest(deps({ force: true, discover: fake(["fail.example.io"]), gmail: gmailThat({ status: "failed", code: "rate_limited", retryable: true, reason: "Gmail refused it" }) }));
    expect(failed.status === "ran" && failed.digest).toMatchObject({ email_status: "failed", email_note: "Gmail refused it" });
    const unknown = await runDigest(deps({ force: true, discover: fake(["unknown.example.io"]), gmail: gmailThat({ status: "unknown", reason: "Timed out" }) }));
    expect(unknown.status === "ran" && unknown.digest.email_note).toBe("It may or may not have been delivered: Timed out");
  }, 60_000);

  it("records a search that failed as a digest with its problem, and sends nothing", async () => {
    const { deps } = await setup();
    const calls: unknown[] = [];
    const r = await runDigest(deps({ force: true, gmail: gmailThat({ status: "sent", messageId: "x", threadId: null }, calls), discover: async () => { throw new Error("Hunter said no"); } }));
    expect(r.status === "ran" && r.digest).toMatchObject({ found: [], problems: ["Hunter said no"], email_status: "not_sent", email_note: "The search did not complete, so there was nothing to send." });
    expect(calls).toEqual([]);
  }, 60_000);

  it("sends the owner's note with a run id that can be found in Sent, and never a prospect's address", async () => {
    const { deps } = await setup();
    const calls: { runId: string; subject: string; body: string }[] = [];
    await runDigest(deps({ force: true, discover: fake(["sentcheck.example.io"]), gmail: gmailThat({ status: "sent", messageId: "m", threadId: null }, calls) }));
    expect(calls[0]!.runId).toMatch(/^digest-\d{4}-\d{2}-\d{2}$/);
    expect(calls[0]!.body).not.toMatch(/@sentcheck/);
  }, 60_000);

  it("lets a viewer read the saved search and the digests", async () => {
    const { w } = await setup();
    const viewer = pgPort(w.db.as(w.users.viewer));
    expect((await loadSearch(viewer))!.version).toBeGreaterThan(0);
    expect((await loadDigests(viewer)).length).toBeGreaterThan(0);
  }, 60_000);
});
