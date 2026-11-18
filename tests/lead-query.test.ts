import { describe, expect, it } from "vitest";
import { HUBSPOT_STATUS, leadsToCsv } from "@/lib/app/lead-export";
import { applyLeadQuery, DEFAULT_QUERY, describeQuery, isFiltered, parseLeadQuery, toSearch, type LeadQuery } from "@/lib/app/lead-query";
import type { Lead } from "@/lib/app/leads";
import type { OutcomeId, Standing } from "@/lib/app/outcomes";
import { STAGES } from "@/lib/app/stages";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-18T09:00:00");
const iso = (d: number) => new Date(NOW + d * DAY).toISOString().slice(0, 10);
const out = (status: OutcomeId, followUpOn: string | null = null, note = ""): Standing => ({ status, note, followUpOn, at: "2026-11-17T10:00:00Z" });
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({ id, runId: "r", domain: `${id}.io`, name: id[0]!.toUpperCase() + id.slice(1), verdict: "qualified", score: 70, lane: "sent", updatedAt: "2026-11-10T00:00:00Z", reasons: ["compliance status"], contact: { name: "Priya Rao", first: "Priya", last: "Rao", title: "CTO", email: "priya@x.io" }, pains: ["Audit preparation eats engineering time"], emailStatus: "sent", outcome: null, usesCompetitor: false, ...over });
const q = (o: Partial<LeadQuery> = {}): LeadQuery => ({ ...DEFAULT_QUERY, ...o });

describe("the lead query in the address", () => {
  it("reads what it knows and ignores what it does not", () => {
    expect(parseLeadQuery({})).toEqual(DEFAULT_QUERY);
    expect(parseLeadQuery({ view: "board", q: "  vanta ", verdict: "maybe", outcome: "replied", sort: "name", skip: "competitor" })).toEqual({ view: "board", q: "vanta", verdict: "maybe", outcome: "replied", sort: "name", skipCompetitor: true });
    expect(parseLeadQuery({ view: "nonsense", verdict: "x", outcome: "x", sort: "x", skip: "y" })).toEqual(DEFAULT_QUERY);
  });

  it("still understands the first version's ?show= links", () => {
    expect(parseLeadQuery({ show: "all" }).view).toBe("all");
    expect(parseLeadQuery({ show: "follow" }).view).toBe("follow");
    expect(parseLeadQuery({ show: "follow" }).sort).toBe("follow");
  });

  it("takes the first of a repeated parameter and trims a long search", () => {
    expect(parseLeadQuery({ q: ["a", "b"] }).q).toBe("a");
    expect(parseLeadQuery({ q: "x".repeat(200) }).q).toHaveLength(80);
  });

  it("writes only what differs from the default, and reads back what it wrote", () => {
    expect(toSearch(DEFAULT_QUERY)).toBe("");
    const full = q({ view: "all", q: "paddle", verdict: "maybe", outcome: "none", sort: "recent", skipCompetitor: true });
    expect(parseLeadQuery(Object.fromEntries(new URLSearchParams(toSearch(full))))).toEqual(full);
    expect(toSearch(parseLeadQuery({ view: "follow" }))).toBe("?view=follow");
  });

  it("says in words what is filtered", () => {
    expect(isFiltered(DEFAULT_QUERY)).toBe(false);
    expect(isFiltered(q({ sort: "name", view: "all" }))).toBe(false);
    expect(describeQuery(q({ q: "pay", verdict: "not_fit", outcome: "replied", skipCompetitor: true }))).toBe("“pay”, not fit, replied, no competitor");
    expect(describeQuery(q({ outcome: "none" }))).toBe("nothing recorded");
  });
});

describe("applying a query", () => {
  const leads = [
    lead("alpha", { score: 90 }),
    lead("beta", { score: 60, verdict: "maybe", outcome: out("reached_out", iso(2)) }),
    lead("gamma", { score: 30, verdict: "not_fit" }),
    lead("delta", { score: 75, outcome: out("not_interested"), usesCompetitor: true }),
    lead("epsilon", { score: 80, outcome: out("replied", iso(-1)), contact: { name: "Sam Lee", first: "Sam", last: "Lee", title: "Head of Security", email: "sam@x.io" }, pains: ["Repeated security questionnaires from prospects"] }),
  ];
  const ids = (x: Lead[]) => x.map((l) => l.id);

  it("shows worth-a-call by fit, leaving out a clear no and what is not a fit", () => {
    expect(ids(applyLeadQuery(leads, q(), NOW))).toEqual(["alpha", "epsilon", "beta"]);
  });

  it("shows everything under 'all', and only dated follow-ups under 'follow', overdue first", () => {
    expect(applyLeadQuery(leads, q({ view: "all" }), NOW)).toHaveLength(5);
    expect(ids(applyLeadQuery(leads, q({ view: "follow" }), NOW))).toEqual(["epsilon", "beta"]);
  });

  it("shows on the board every lead that is in a stage, including a closed one, but not one in none", () => {
    expect(ids(applyLeadQuery(leads, q({ view: "board" }), NOW)).sort()).toEqual(["alpha", "beta", "delta", "epsilon"]);
  });

  it("filters by fit, by outcome (including 'nothing recorded') and by competitor", () => {
    expect(ids(applyLeadQuery(leads, q({ view: "all", verdict: "maybe" }), NOW))).toEqual(["beta"]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", outcome: "replied" }), NOW))).toEqual(["epsilon"]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", outcome: "none" }), NOW))).toEqual(["alpha", "gamma"]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", skipCompetitor: true }), NOW))).not.toContain("delta");
  });

  it("searches company, domain, person, title, pains and reasons, all words needed, any case", () => {
    expect(ids(applyLeadQuery(leads, q({ view: "all", q: "EPSILON" }), NOW))).toEqual(["epsilon"]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", q: "sam security" }), NOW))).toEqual(["epsilon"]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", q: "questionnaires" }), NOW))).toEqual(["epsilon"]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", q: "sam nonexistent" }), NOW))).toEqual([]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", q: "beta.io" }), NOW))).toEqual(["beta"]);
  });

  it("sorts by fit, name, follow-up date or recency, and does not change what it was given", () => {
    const copy = [...leads];
    expect(ids(applyLeadQuery(leads, q({ view: "all", sort: "name" }), NOW))).toEqual(["alpha", "beta", "delta", "epsilon", "gamma"]);
    expect(ids(applyLeadQuery(leads, q({ view: "all", sort: "follow" }), NOW)).slice(0, 2)).toEqual(["epsilon", "beta"]);
    const recent = [lead("old", { updatedAt: "2026-11-01T00:00:00Z" }), lead("new", { updatedAt: "2026-11-15T00:00:00Z" })];
    expect(ids(applyLeadQuery(recent, q({ view: "all", sort: "recent" }), NOW))).toEqual(["new", "old"]);
    expect(leads).toEqual(copy);
  });
});

describe("exporting leads", () => {
  const l1 = lead("alpha", { score: 90, outcome: out("meeting_booked", iso(3), "Tuesday 3pm") });
  const l2 = lead("beta", { verdict: "not_fit", contact: { name: "A shared mailbox", first: null, last: null, title: null, email: "sales@beta.io" } });

  it("writes a plain CSV with one row per lead, the stage, the outcome and the contact", () => {
    const lines = leadsToCsv([l1], "csv").replace("﻿", "").split("\r\n");
    expect(lines[0]).toBe('"company","domain","fit","score","stage","outcome","follow_up_on","contact","contact_title","contact_email","why_it_fits","pains","uses_competitor","last_note"');
    expect(lines[1]).toContain('"Alpha","alpha.io","qualified","90","Meeting booked","Meeting booked"');
    expect(lines[1]).toContain("priya@x.io");
    expect(lines[1]).toContain("Tuesday 3pm");
  });

  it("writes a HubSpot file with HubSpot's own column names and Lead Status values", () => {
    const lines = leadsToCsv([l1, l2], "hubspot").replace("﻿", "").split("\r\n");
    expect(lines[0]).toBe('"Company name","Company Domain Name","First Name","Last Name","Email","Job Title","Lead Status","Notes"');
    expect(lines[1]).toContain('"Alpha","alpha.io","Priya","Rao","priya@x.io","CTO","IN_PROGRESS"');
    expect(lines[2]).toContain('"Beta","beta.io","","A shared mailbox","sales@beta.io","","UNQUALIFIED"');
  });

  it("maps every stage to a HubSpot status", () => {
    for (const s of STAGES) expect(HUBSPOT_STATUS[s.id]).toMatch(/^[A-Z_]+$/);
  });

  it("neutralises a cell that would run as a formula in a spreadsheet", () => {
    const evil = lead("evil", { name: "=HYPERLINK(\"http://x\")", reasons: ["+cmd|' /C calc'!A0"] });
    const csv = leadsToCsv([evil], "csv");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("carries a viewer's masked address and never a real one", () => {
    const masked = lead("masked", { contact: { name: "P.", first: null, last: null, title: "CTO", email: "p***@masked.io" } });
    const csv = leadsToCsv([masked], "csv");
    expect(csv).toContain("p***@masked.io");
    expect(csv).not.toContain("priya");
  });

  it("is only the header for no leads", () => {
    expect(leadsToCsv([], "csv").replace("﻿", "").trim().split("\r\n")).toHaveLength(1);
  });
});
