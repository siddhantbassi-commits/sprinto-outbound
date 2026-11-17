import { describe, expect, it } from "vitest";
import { ask } from "@/lib/ask/ask";
import { demoAskAi } from "@/lib/ask/demo";
import { pgPort } from "@/lib/db/pg-port";
import { getDemo } from "@/lib/demo/world";

const run = async (question: string, role: "viewer" | "pending" = "viewer") => {
  const d = await getDemo();
  return ask({ ai: demoAskAi(), db: pgPort(d.db.as(d.users[role])), question });
};

describe("the demo stand-in for Ask", () => {
  it.each([
    ["Who is waiting for a person?", "list_companies", /harborpay\.com/],
    ["Which companies had no usable contact?", "list_companies", /brightwave\.ai/],
    ["Tell me about northwind.io", "company_story", /northwind\.io is in the “Sent \(test\)” lane/],
    ["Why was petalpop.app not a fit?", "company_story", /petalpop\.app/],
    ["How many companies are in each outcome?", "count_by_outcome", /There are 8 companies/],
    ["Show me the funnel", "impact_summary", /8 added/],
    ["What are the send rules?", "settings_and_rules", /only to the owner/],
    ["Show recent runs", "list_runs", /7 companies/],
    ["Is anyone on the do-not-contact list?", "list_suppressions", /do-not-contact|Nothing/],
  ])("answers %s with %s, from real lookups", async (q, tool, answer) => {
    const r = await run(q);
    expect(r.ok, q).toBe(true);
    if (!r.ok) return;
    expect(r.evidence.map((e) => e.tool)).toEqual([tool]);
    expect(r.answer).toMatch(answer);
    expect(r.unsupported, `${q}: ${r.answer}`).toEqual({ domains: [], numbers: [] });
  });

  it("says it cannot do a thing it has no lookup for, and changes nothing", async () => {
    const d = await getDemo();
    const before = await d.db.admin<{ n: number }>("select count(*)::int n from public.decisions");
    const r = await run("Please send an email to every company and delete the failed ones");
    expect(r).toMatchObject({ ok: false, code: "no_lookup" });
    expect((await d.db.admin<{ n: number }>("select count(*)::int n from public.decisions"))[0]!.n).toBe(before[0]!.n);
  });

  it("finds no record for an unknown company, and for a person who is not approved", async () => {
    const a = await run("Tell me about nobody-here.com");
    expect(a.ok && a.answer).toMatch(/no record of nobody-here\.com/);
    const b = await run("Tell me about northwind.io", "pending");
    expect(b.ok && b.answer).toMatch(/no record/);
  });

  it("never includes a contact's name or address in an answer", async () => {
    const r = await run("Tell me about northwind.io");
    expect(r.ok && r.answer).not.toMatch(/@/);
  });
});
