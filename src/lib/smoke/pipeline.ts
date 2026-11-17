import type { AiClient } from "@/lib/ai/types";
import type { Candidate } from "@/lib/contacts/rank";
import type { HunterClient } from "@/lib/contacts/hunter";
import { newDb } from "@/lib/db/pglite";
import { pgPort } from "@/lib/db/pg-port";
import { demoGmail, seedWorld, type OutboxMessage } from "@/lib/demo/world";
import type { FetchDeps } from "@/lib/scrape/fetch";
import { normaliseDomain } from "@/lib/scrape/url-guard";
import { Store } from "@/lib/worker/store";
import { tick } from "@/lib/worker/tick";
import { fail, pass, warn, type Check } from "./report";

/**
 * A dry run on one REAL company: the real scraper reads its real site and the real model reads it, in a throwaway
 * in-memory database. Hunter is a stand-in unless a real one is passed, and the email is built but never sent anywhere.
 * It shows what the system would make of a company before any real account is involved.
 */

const S = "pipeline";

export interface DryRunOptions {
  domain: string;
  ai: AiClient;
  fetchDeps: FetchDeps;
  /** A real Hunter client, or null to use a made-up contact. */
  hunter: HunterClient | null;
}

export interface DryRunResult {
  checks: Check[];
  /** The email as it would have arrived, with the test-mode header, if one was written. */
  email: string | null;
}

const stubHunter = (domain: string): HunterClient => ({
  account: async () => ({ remaining: 50, used: 0, available: 50, unit: "credits", resetDate: null }),
  domainSearch: async () => {
    const c: Candidate = { source: "hunter", firstName: "Sample", lastName: "Person", position: "CTO", email: `sample.person@${domain}`, type: "personal", seniority: "executive", department: "it", confidence: 90, verification: "valid" };
    return { candidates: [c], creditsUsed: 0, total: 1 };
  },
});

export async function dryRun(o: DryRunOptions): Promise<DryRunResult> {
  const checked = normaliseDomain(o.domain);
  if (!checked.ok) return { checks: [fail(S, "domain", `Dry run on ${o.domain}`, checked.reason)], email: null };
  const domain = checked.domain;

  const db = await newDb();
  const users = await seedWorld(db);
  const outbox: OutboxMessage[] = [];
  const store = new Store(pgPort(db.as(users.worker)));
  await db.as(users.operator).query("select public.create_run($1::text[], 'paste', 'Dry run', '{}'::jsonb)", [[domain]]);
  const t = await tick({ store, ai: o.ai, fetchDeps: o.fetchDeps, hunter: o.hunter ?? stubHunter(domain), gmail: demoGmail(outbox), appUrl: null, now: Date.now, stepBudgetMs: 45_000 }, { source: "browser", maxSteps: 30 });

  const [p] = await db.admin<{ id: string; lane: string; lane_reason: string | null; step: string; score: number | null; verdict: string | null }>("select id, lane, lane_reason, step, score, verdict from public.prospects");
  const out: Check[] = [];
  if (t.errors.length) out.push(warn(S, "errors", "The worker reported errors", t.errors.slice(0, 3).join(" | ")));
  if (!p) return { checks: [...out, fail(S, "prospect", `Dry run on ${domain}`, "no prospect was created")], email: null };

  const pages = await db.admin<{ url: string; thin: boolean }>("select url, thin from public.pages where prospect_id = $1", [p.id]);
  out.push(pages.length ? pass(S, "scrape", `${domain} was read`, `${pages.length} pages (${pages.filter((x) => x.thin).length} thin): ${pages.map((x) => new URL(x.url).pathname).join(", ")}`) : fail(S, "scrape", `${domain} was read`, p.lane_reason ?? "no pages were stored", "A JavaScript-only site gives no text; try another domain."));

  const [facts] = await db.admin<{ facts: Record<string, { value: unknown }>; grounding: { checked: number; failures: string[] }; injection: unknown[] }>("select facts, grounding, injection from public.facts where prospect_id = $1 order by pass desc limit 1", [p.id]);
  if (facts) {
    const known = Object.entries(facts.facts).filter(([, f]) => f.value !== null);
    out.push((facts.grounding.failures.length > 2 ? warn : pass)(S, "facts", "The model's facts were checked against the page", `${known.length} facts known (${known.slice(0, 8).map(([k, f]) => `${k}=${String(f.value)}`).join(", ")}); ${facts.grounding.checked} quotes checked, ${facts.grounding.failures.length} not found${facts.injection.length ? `; ${facts.injection.length} page(s) flagged for trying to instruct the model` : ""}`));
  }

  if (p.score !== null) {
    const [sc] = await db.admin<{ parts: { label: string; points: number }[]; missing: string[]; reason: string }>("select parts, missing, reason from public.scores where prospect_id = $1 order by created_at desc limit 1", [p.id]);
    const top = (sc?.parts ?? []).filter((x) => x.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((x) => `${x.label} ${x.points}`).join("; ");
    out.push(pass(S, "score", `Scored ${p.score}/100 (${p.verdict})`, `${top || "no points"}${sc?.missing.length ? `; unknown: ${sc.missing.join(", ")}` : ""}`));
  }

  out.push(
    p.lane === "sent"
      ? pass(S, "end", "It went all the way to a (pretend) send", "step by step: scrape, qualify, contact, pains, draft, send")
      : (p.lane === "not_fit" || p.lane === "needs_more" ? warn : p.lane === "failed" ? fail : warn)(S, "end", `It stopped as "${p.lane}"`, p.lane_reason ?? "no reason recorded", p.lane === "needs_more" ? "That is the system declining to guess. Not a fault." : undefined),
  );

  const [em] = await db.admin<{ subject: string; body: string; lint: { id: string; pass: boolean; message: string }[] }>("select subject, body, lint from public.emails order by attempt desc limit 1");
  if (em) {
    const bad = em.lint.filter((c) => !c.pass);
    out.push((bad.length ? warn : pass)(S, "email", "A draft was written", `${em.body.split(/\s+/).length} words; ${em.lint.length - bad.length} of ${em.lint.length} checks passed${bad.length ? ` (failed: ${bad.map((b) => b.id).join(", ")})` : ""}`));
  }
  const [usage] = await db.admin<{ tokens: string }>("select coalesce(sum(units), 0)::text tokens from public.usage_ledger where kind = 'gemini_tokens'");
  out.push(pass(S, "tokens", "Model tokens used", `${Number(usage?.tokens ?? 0).toLocaleString("en-GB")} tokens for this one company`));
  return { checks: out, email: outbox[0] ? `Subject: ${outbox[0].subject}\n\n${outbox[0].text}` : em ? `Subject: ${em.subject}\n\n${em.body}` : null };
}
