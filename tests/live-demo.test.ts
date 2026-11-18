import { describe, expect, it } from "vitest";
import type { AiClient } from "@/lib/ai/types";
import { pgPort } from "@/lib/db/pg-port";
import { demoAi, extractionFor } from "@/lib/demo/ai";
import type { DemoCompany } from "@/lib/demo/companies";
import { createDailyCounter } from "@/lib/demo/live";
import { demoSite, getDemo, type LiveParts } from "@/lib/demo/world";
import type { HunterClient } from "@/lib/contacts/hunter";
import type { FetchDeps, Transport } from "@/lib/scrape/fetch";
import { Store } from "@/lib/worker/store";
import { tick } from "@/lib/worker/tick";

/**
 * A company that is not a sample goes through the real worker, with stand-ins in place of the real model, internet and Hunter
 * so the test is offline. It proves the wiring: which services a new company reaches, that the real contact is stored for the
 * pipeline but never shown, and that nothing real reaches the pretend inbox.
 */
const NEW: DemoCompany = {
  domain: "tidepool-labs.io",
  name: "Tidepool Labs",
  kind: "strong",
  compliance: "in_progress",
  band: "51-200",
  hiring: "security_role",
  s: {
    product: "Tidepool Labs builds workflow software that helps operations teams plan and track work across the company.",
    plan: "Enterprise customers get SSO, audit logs and a dedicated success manager on the Enterprise plan.",
    data: "Your data is stored in your Tidepool account and encrypted at rest on our servers.",
    cert: "We are working towards SOC 2 and expect to complete our audit this year.",
    size: "We are a team of 120 people across three offices.",
    hiring: "Open role: Head of Security and Compliance. Join us to build our first security programme.",
    logos: "Trusted by enterprise teams worldwide, including several large banks and insurers.",
  },
  contacts: [],
};

describe("a new company in the public demo with live research", () => {
  it("is read by the real model, finds a contact with the real Hunter, and shows no real person anywhere", async () => {
    const w = await getDemo();
    const seen = { ai: 0, scriptedAi: 0, pages: 0, searches: [] as string[] };
    const scripted = demoAi();
    const real: AiClient = {
      async generateJson(req) {
        seen.ai += 1;
        if (req.purpose === "extract") return { data: extractionFor(NEW), usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 }, model: "real-stand-in", latencyMs: 1 };
        return scripted.generateJson(req);
      },
      generateTurn: (req) => scripted.generateTurn(req),
    };
    const routes = new Map(Object.entries(demoSite(NEW)));
    const transport: Transport = async ({ url }) => {
      seen.pages += 1;
      if (url.pathname === "/robots.txt") return { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from(""), truncated: false };
      const html = routes.get(url.href);
      return html ? { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(html), truncated: false } : { status: 404, headers: { "content-type": "text/html" }, body: Buffer.from("no"), truncated: false };
    };
    const fetchDeps: FetchDeps = { resolve: async () => ["93.184.216.34"], transport, userAgent: "test-bot" };
    const hunter: HunterClient = {
      account: async () => ({ remaining: 40, used: 10, available: 50, unit: "credits", resetDate: null }),
      domainSearch: async (d) => {
        seen.searches.push(d);
        return { candidates: [{ source: "hunter", firstName: "Priya", lastName: "Raman", position: "Head of Security", email: "priya.raman@tidepool-labs.io", type: "personal", seniority: "senior", department: "security", confidence: 93, verification: "valid" }], creditsUsed: 1, total: 1 };
      },
    };
    const counter = createDailyCounter(3);
    const live: LiveParts = { ai: real, fetchDeps, hunter, hunterCounter: counter };

    // No approval needed for this test, so the email goes straight to the pretend inbox.
    await w.db.as(w.users.admin).query("insert into public.settings_versions (test_to, sender_name, sender_title, postal_address, require_approval, reason) select test_to, sender_name, sender_title, postal_address, false, 'Test' from public.settings_now()");
    await w.db.as(w.users.operator).query("select public.create_run($1::text[], 'paste', 'Live', '{}'::jsonb)", [[NEW.domain]]);
    await tick(w.deps(new Store(pgPort(w.db.as(w.users.worker))), live), { source: "browser", maxSteps: 60 });

    const [p] = await w.db.admin<{ id: string; lane: string; verdict: string | null; score: number | null }>("select id, lane, verdict, score from public.prospects where domain = $1", [NEW.domain]);
    expect(p).toBeTruthy();
    expect(p!.lane).toBe("sent");
    expect(seen.ai).toBeGreaterThan(2); // extraction, pains and draft all went to the real model
    expect(seen.pages).toBeGreaterThan(0);
    expect(seen.searches).toEqual([NEW.domain]);
    expect(counter.used).toBe(1);

    // The pipeline needs the real address, so it is stored; the masked view that visitors read hides it.
    const [stored] = await w.db.admin<{ email: string }>("select email from public.contacts where prospect_id = $1 and chosen", [p!.id]);
    expect(stored!.email).toBe("priya.raman@tidepool-labs.io");
    const [masked] = await w.db.as(w.users.viewer).query<{ first_initial: string; email_masked: string }>("select first_initial, email_masked from public.contacts_masked where prospect_id = $1 and chosen", [p!.id]);
    expect(masked).toEqual({ first_initial: "P.", email_masked: "p***@tidepool-labs.io" });

    // The pretend inbox carries the notice with the person masked: no surname, no address.
    const mail = w.outbox.find((m) => m.text.includes("Tidepool"));
    expect(mail).toBeTruthy();
    expect(mail!.to).toBe("demo-inbox@example.com");
    expect(mail!.text).toMatch(/Would have gone to: P\., Head of Security at .+ <p\*\*\*@tidepool-labs\.io>/);
    for (const part of [mail!.text, mail!.html ?? ""]) {
      expect(part).not.toContain("priya.raman");
      expect(part).not.toContain("Raman");
    }
  }, 120_000);
});
