import { describe, expect, it } from "vitest";
import { DEMO_COMPANIES } from "@/lib/demo/companies";
import { DEMO_INBOX, getDemo } from "@/lib/demo/world";
import { pgPort } from "@/lib/db/pg-port";
import { Store } from "@/lib/worker/store";
import { tick } from "@/lib/worker/tick";

describe("demo world", () => {
  it("boots once per process, with one finished sample run whose outcomes are the ones the companies are built to show", async () => {
    const a = await getDemo();
    expect(await getDemo()).toBe(a);
    const rows = await a.db.admin<{ domain: string; lane: string; verdict: string | null }>("select domain, lane, verdict from public.prospects order by domain");
    expect(Object.fromEntries(rows.map((r) => [r.domain, r.lane]))).toEqual({
      "brightwave.ai": "no_contact",
      "harborpay.com": "review",
      "lumenhealth.com": "sent",
      "northwind.io": "sent",
      "petalpop.app": "not_fit",
      "quietcloud.dev": "needs_more",
      "vanta.com": "not_fit",
    });
    expect(rows).toHaveLength(DEMO_COMPANIES.length);
  }, 60_000);

  it("delivers only to the demo inbox, with the defence written above each email", async () => {
    const w = await getDemo();
    expect(w.outbox.length).toBeGreaterThanOrEqual(2);
    for (const m of w.outbox) {
      expect(m.to).toBe(DEMO_INBOX);
      expect(m.text).toMatch(/^TEST MODE\. This message was sent to you only\. It was NOT sent to the contact\./);
      expect(m.text).toMatch(/Would have gone to: .+ at .+ <.+@.+> \(email valid, confidence \d+\)/);
      expect(m.text).toContain("Hi ");
    }
  });

  it("runs the real pipeline: facts are quote-checked, absences are code-checked, and a competitor is refused before any contact lookup", async () => {
    const w = await getDemo();
    const [vanta] = await w.db.admin<{ id: string }>("select id from public.prospects where domain = 'vanta.com'");
    const contacts = await w.db.admin("select * from public.contacts where prospect_id = $1", [vanta!.id]);
    expect(contacts).toEqual([]);
    const [facts] = await w.db.admin<{ grounding: { failures: string[] }; absences: { derived: string[] } }>("select f.grounding, f.absences from public.facts f join public.prospects p on p.id = f.prospect_id where p.domain = 'northwind.io' order by pass desc limit 1");
    expect(facts!.grounding.failures).toEqual([]);
    expect(facts!.absences.derived).toContain("complianceVendor");
  });

  it("has nothing left to do on a second tick, and never sends twice", async () => {
    const w = await getDemo();
    const before = w.outbox.length;
    const store = new Store(pgPort(w.db.as(w.users.worker)));
    expect(await tick(w.deps(store), { source: "browser", maxSteps: 20 })).toMatchObject({ processed: 0 });
    expect(w.outbox).toHaveLength(before);
  });
});

describe("the Impact view on the demo world", () => {
  it("loads through a viewer's own database session, and the figures match what the pipeline did", async () => {
    const { impactData } = await import("@/lib/app/queries");
    const { computeImpact, rangeFor } = await import("@/lib/app/impact");
    const w = await getDemo();
    const data = await impactData(pgPort(w.db.as(w.users.viewer)));
    const x = computeImpact({ ...data, range: rangeFor("all", Date.now()), assumptions: { manualMinutes: 20, reviewMinutesPerEmail: 1.5, reviewMinutesPerDecision: 2 } });
    expect(x.funnel.map((s) => [s.key, s.count])).toEqual([["added", 7], ["read", 7], ["qualified", 3], ["contact", 2], ["drafted", 2], ["sent", 2]]);
    expect(x.dropoffs.map((d) => [d.lane, d.count]).sort()).toEqual([["needs_more", 1], ["no_contact", 1], ["not_fit", 2], ["review", 1]]);
    expect(x.time).toMatchObject({ baselineMinutes: 140, humanMinutes: 3, savedMinutes: 137 });
    expect(x.rates.groundingFailure).toMatchObject({ numerator: 0 });
    expect(x.rates.firstPassLint).toEqual({ value: 1, numerator: 2, denominator: 2 });
    expect(x.usage.tokens).toBeGreaterThan(0);
    expect(x.usage.hunterCredits).toBe(3);
  });
});

describe("Replay on the demo world", () => {
  async function loadSubjects() {
    const { replaySubjects } = await import("@/lib/app/queries");
    const w = await getDemo();
    return replaySubjects(pgPort(w.db.as(w.users.admin)));
  }
  const side = async (mut: (c: import("@/lib/icp/config").IcpConfig) => void, blocklist: string[] = []) => {
    const { ICP_V1 } = await import("@/lib/icp/config");
    const c = structuredClone(ICP_V1);
    mut(c);
    return { config: c, blocklist };
  };

  it("finds every scored company and reproduces each stored verdict exactly, from the facts alone", async () => {
    const { replay } = await import("@/lib/icp/replay");
    const subjects = await loadSubjects();
    expect(subjects.map((s) => s.domain).sort()).toEqual(["brightwave.ai", "harborpay.com", "lumenhealth.com", "northwind.io", "petalpop.app", "quietcloud.dev", "vanta.com"]);
    expect(subjects.every((s) => s.textChars !== null && s.pages !== null)).toBe(true);
    const same = await side(() => undefined);
    const r = replay(subjects, same, same);
    expect(r.reproduces).toEqual({ matching: 7, of: 7, olderVersion: 0, other: 0 });
    expect(subjects.every((s) => s.stored.version === 1)).toBe(true);
    expect(r.movers).toEqual([]);
    expect(r.approximated).toBe(0);
  });

  it("shows the maybe now qualifying under a lower bar, and a strong company dropping under a higher one", async () => {
    const { replay } = await import("@/lib/icp/replay");
    const subjects = await loadSubjects();
    const base = await side(() => undefined);
    const lower = replay(subjects, base, await side((c) => (c.qualifyAt = 55)));
    expect(lower.movers.map((m) => [m.domain, m.kind])).toEqual([["harborpay.com", "now_qualifies"]]);
    const higher = replay(subjects, base, await side((c) => (c.qualifyAt = 88)));
    expect(higher.movers.map((m) => [m.domain, m.kind]).sort()).toEqual([["brightwave.ai", "no_longer_qualifies"], ["lumenhealth.com", "no_longer_qualifies"]]);
  });

  it("applies a blocklist entry to a company the base version would write to", async () => {
    const { replay } = await import("@/lib/icp/replay");
    const subjects = await loadSubjects();
    const r = replay(subjects, await side(() => undefined), await side(() => undefined, ["northwind.io"]));
    expect(r.movers).toMatchObject([{ domain: "northwind.io", from: { verdict: "qualified" }, to: { verdict: "not_fit" } }]);
  });

  it("changes nothing in the database", async () => {
    const { replay } = await import("@/lib/icp/replay");
    const w = await getDemo();
    const count = async () => (await w.db.admin<{ n: number }>("select (select count(*) from public.scores) + (select count(*) from public.icp_versions) + (select count(*) from public.prospects where lane <> 'sent') n"))[0]!.n;
    const before = await count();
    replay(await loadSubjects(), await side(() => undefined), await side((c) => (c.qualifyAt = 55)));
    expect(await count()).toBe(before);
  });
});
