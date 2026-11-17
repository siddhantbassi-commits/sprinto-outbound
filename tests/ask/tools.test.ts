import { describe, expect, it } from "vitest";
import { ASK_TOOLS, runAskTool, validateAsk } from "@/lib/ask/tools";
import { pgPort } from "@/lib/db/pg-port";
import type { DbPort, Row } from "@/lib/db/port";
import { getDemo } from "@/lib/demo/world";

const as = async (role: "admin" | "operator" | "viewer" | "pending") => {
  const d = await getDemo();
  return pgPort(d.db.as(d.users[role]));
};
const ok = (name: string, args: Record<string, unknown>) => {
  const v = validateAsk(name, args);
  if (!v.ok) throw new Error(v.reason);
  return v.args;
};

describe("validateAsk", () => {
  it("only knows the declared tools, and refuses anything else", () => {
    expect(ASK_TOOLS.map((t) => t.name).sort()).toEqual(["company_story", "count_by_outcome", "impact_summary", "list_companies", "list_runs", "list_suppressions", "settings_and_rules"]);
    for (const n of ["run_sql", "send_email", "promote", "fetch_page", "__proto__", ""]) expect(validateAsk(n, {}).ok).toBe(false);
  });
  it("checks a lane, a verdict, a domain fragment, a run id and a limit", () => {
    expect(validateAsk("list_companies", { lane: "drop table" }).ok).toBe(false);
    expect(validateAsk("list_companies", { verdict: "great" }).ok).toBe(false);
    expect(validateAsk("list_companies", { domain_contains: "a b" }).ok).toBe(false);
    expect(validateAsk("list_companies", { domain_contains: "x".repeat(61) }).ok).toBe(false);
    expect(validateAsk("list_companies", { run_id: "1 or 1=1" }).ok).toBe(false);
    for (const limit of [0, 26, 1.5, "5", null]) expect(validateAsk("list_companies", { limit }).ok, String(limit)).toBe(false);
    expect(validateAsk("list_companies", { lane: "review", verdict: "maybe", domain_contains: "Acme", limit: 25 })).toEqual({ ok: true, args: { lane: "review", verdict: "maybe", domain_contains: "acme", limit: 25 } });
  });
  it("needs a real domain for a company story, and lower-cases it", () => {
    for (const d of ["acme", "https://acme.com", "acme.com/x", "a b.com", "-a.com", "", 5, undefined, "a".repeat(200) + ".com"]) expect(validateAsk("company_story", { domain: d }).ok, String(d)).toBe(false);
    expect(validateAsk("company_story", { domain: " Acme.COM " })).toEqual({ ok: true, args: { domain: "acme.com" } });
  });
  it("drops arguments a tool does not take", () => {
    expect(validateAsk("list_suppressions", { anything: "x" })).toEqual({ ok: true, args: {} });
    expect(validateAsk("impact_summary", { range: "90" }).ok).toBe(false);
    expect(validateAsk("list_runs", { limit: 11 }).ok).toBe(false);
  });
});

function fakeDb(tables: Record<string, Row[]>): DbPort {
  return {
    async rpc() {
      return [];
    },
    async insert() {
      throw new Error("read only");
    },
    async select(table, where = {}, opts = {}) {
      const all = (tables[table] ?? []).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 1000));
    },
  };
}

describe("the lookups, on the sample run", () => {
  it("filters by verdict, by part of a domain, and by run", async () => {
    const db = await as("viewer");
    const q = await runAskTool(db, "list_companies", ok("list_companies", { verdict: "qualified" }));
    expect((q.data.companies as { verdict: string }[]).every((c) => c.verdict === "qualified")).toBe(true);
    expect(q.data.total_matching).toBeGreaterThan(0);
    expect(q.data.total_matching).toBeLessThan(8);
    const d = await runAskTool(db, "list_companies", ok("list_companies", { domain_contains: "north" }));
    expect((d.data.companies as { domain: string }[]).map((c) => c.domain)).toEqual(["northwind.io"]);
    const runs = (await runAskTool(db, "list_runs", {})).data.runs as { run_id: string; companies: number }[];
    const sample = runs.find((r) => r.companies === 7)!;
    expect((await runAskTool(db, "list_companies", ok("list_companies", { run_id: sample.run_id }))).data.total_matching).toBe(7);
    expect((await runAskTool(db, "count_by_outcome", ok("count_by_outcome", { run_id: sample.run_id }))).data.total).toBe(7);
    expect((await runAskTool(db, "list_companies", ok("list_companies", { run_id: "00000000-0000-4000-8000-000000000000" }))).data.total_matching).toBe(0);
  });

  it("leaves out facts read with low confidence, and score parts that earned nothing", async () => {
    const db = fakeDb({
      prospects: [{ id: "p1", run_id: "r1", domain: "acme.com", step: "qualified", lane: "review", lane_reason: null, score: 50, verdict: "maybe", created_at: "2026-11-04" }],
      facts: [{ prospect_id: "p1", pass: 1, facts: { headcount: { value: "51-200", confidence: "high", quotes: ["120 people"] }, product: { value: "saas", confidence: "low", quotes: ["maybe"] }, sellsEu: { value: null, confidence: "high", quotes: [] } } }],
      scores: [{ prospect_id: "p1", replay: false, created_at: "2026-11-04", reason: "r", missing: [], flags: [], gates: [], parts: [{ label: "Size", points: 10, max: 10, quotes: ["120 people"] }, { label: "Hiring", points: 0, max: 7, quotes: [] }] }],
    });
    const r = await runAskTool(db, "company_story", { domain: "acme.com" });
    const d = r.data as { facts_read: { fact: string }[]; scoring: { points: { label: string }[] } };
    expect(d.facts_read.map((f) => f.fact)).toEqual(["headcount"]);
    expect(d.scoring.points.map((p) => p.label)).toEqual(["Size"]);
  });

  it("trims a long quote instead of passing the whole page", async () => {
    const long = "x".repeat(2000);
    const db = fakeDb({ prospects: [{ id: "p1", run_id: "r1", domain: "acme.com", step: "qualified", lane: "review", lane_reason: long, score: 1, verdict: "maybe", created_at: "2026-11-04" }] });
    const r = await runAskTool(db, "company_story", { domain: "acme.com" });
    expect(String((r.data as { lane_reason: string }).lane_reason).length).toBeLessThan(400);
  });

  it("lists companies by lane, with the total and a link target for each", async () => {
    const db = await as("viewer");
    const r = await runAskTool(db, "list_companies", ok("list_companies", { lane: "review" }));
    expect(r.data.total_matching).toBe(2);
    expect((r.data.companies as { domain: string }[]).map((c) => c.domain).sort()).toEqual(["cobaltledger.io", "harborpay.com"]);
    expect(r.companies.map((c) => c.domain).sort()).toEqual(["cobaltledger.io", "harborpay.com"]);
  });
  it("tells a limited list from the whole, with the true total", async () => {
    const db = await as("viewer");
    const r = await runAskTool(db, "list_companies", ok("list_companies", { limit: 2 }));
    expect(r.data.shown).toBe(2);
    expect(r.data.total_matching).toBeGreaterThan(2);
  });
  it("counts by outcome", async () => {
    const r = await runAskTool(await as("viewer"), "count_by_outcome", {});
    expect(r.data.total).toBe(8);
    expect((r.data.lanes as Record<string, number>).sent).toBe(2);
  });
  it("tells the whole story of one company: score reasons, quotes, steps, email and its checks", async () => {
    const r = await runAskTool(await as("viewer"), "company_story", { domain: "northwind.io" });
    const d = r.data as Record<string, any>;
    expect(d.found).toBe(true);
    expect(d.lane).toBe("sent");
    expect(d.scoring.points.length).toBeGreaterThan(0);
    expect(d.facts_read.length).toBeGreaterThan(0);
    expect(d.steps.length).toBeGreaterThan(3);
    expect(d.outreach_email.status).toBe("sent");
    expect(d.chosen_contact).toHaveLength(1);
    expect(r.companies).toEqual([{ domain: "northwind.io", id: expect.any(String) }]);
  });
  it("says so when a company has never been run, rather than inventing one", async () => {
    const r = await runAskTool(await as("viewer"), "company_story", { domain: "never-heard-of-it.com" });
    expect(r.data).toMatchObject({ found: false });
    expect(r.companies).toEqual([]);
  });
  it("never gives the model a contact's name or address, even to an admin", async () => {
    for (const role of ["admin", "operator", "viewer"] as const) {
      const r = await runAskTool(await as(role), "company_story", { domain: "northwind.io" });
      const body = JSON.stringify(r.data);
      expect(body, role).not.toMatch(/@/);
      expect(body, role).not.toMatch(/first_name|last_name|email_masked|"email"/);
    }
  });
  it("shows a pending person nothing at all", async () => {
    const db = await as("pending");
    expect((await runAskTool(db, "count_by_outcome", {})).data.total).toBe(0);
    expect((await runAskTool(db, "company_story", { domain: "northwind.io" })).data).toMatchObject({ found: false });
    expect((await runAskTool(db, "list_suppressions", {})).data.count).toBe(0);
  });
  it("reads runs, suppressions, the funnel and the rules", async () => {
    const db = await as("viewer");
    const runs = await runAskTool(db, "list_runs", {});
    expect((runs.data.runs as unknown[]).length).toBeGreaterThan(0);
    const sup = await runAskTool(db, "list_suppressions", {});
    expect(typeof sup.data.count).toBe("number");
    const impact = await runAskTool(db, "impact_summary", { range: "all" });
    expect(impact.data.domains_added).toBe(8);
    const rules = await runAskTool(db, "settings_and_rules", {});
    expect(rules.data.test_mode).toMatch(/only to the owner/);
    expect(JSON.stringify(rules.data)).not.toMatch(/password|secret|key/i);
  });
  it("cannot be used to write: nothing it ran changed a row", async () => {
    const d = await getDemo();
    const before = await d.db.admin<{ n: number }>("select (select count(*) from public.step_events)::int + (select count(*) from public.decisions)::int + (select count(*) from public.suppressions)::int n");
    const db = await as("admin");
    for (const [n, a] of [["list_companies", {}], ["company_story", { domain: "northwind.io" }], ["count_by_outcome", {}], ["list_runs", {}], ["list_suppressions", {}], ["impact_summary", {}], ["settings_and_rules", {}]] as const) await runAskTool(db, n, a);
    const after = await d.db.admin<{ n: number }>("select (select count(*) from public.step_events)::int + (select count(*) from public.decisions)::int + (select count(*) from public.suppressions)::int n");
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
