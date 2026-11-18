import { createHash } from "node:crypto";
import type { HunterClient } from "@/lib/contacts/hunter";
import { createGmailSender, type GmailSender } from "@/lib/email/gmail";
import { readMessage } from "@/lib/email/mime";
import { Db, newDb, type Role } from "@/lib/db/pglite";
import { pgPort } from "@/lib/db/pg-port";
import { SPRINTO_FACTS_SEED } from "@/lib/pitch/sprinto-facts";
import type { FetchDeps, Transport } from "@/lib/scrape/fetch";
import { botUserAgent } from "@/lib/scrape/site";
import type { PipelineDeps } from "@/lib/worker/pipeline";
import { Store } from "@/lib/worker/store";
import { tick } from "@/lib/worker/tick";
import { demoAi } from "./ai";
import { DEMO_BY_DOMAIN, DEMO_COMPANIES, DEMO_DISCOVERABLE, UP_NEXT, type DemoCompany } from "./companies";

/**
 * Demo mode: the whole product running on sample data, in memory, with no keys and no network. The database is the real
 * schema on a real Postgres engine, the worker is the real worker, and the pages, the quote check, the score, the lint and
 * the send safety all run for real. Only the outside world is pretend: the websites, the model, Hunter and Gmail.
 * It never runs in production (see env.ts), and nothing it "sends" leaves the process.
 */

export const DEMO_INBOX = "demo-inbox@example.com";

const PAD = "Our platform helps teams ship software with confidence every single day. ".repeat(8);
const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p><p>${PAD}</p></main></body></html>`;

export function demoSite(c: DemoCompany): Record<string, string> {
  const o = `https://${c.domain}`;
  const s = c.s;
  if (c.kind === "thin") return { [`${o}/`]: `<html><head><title>${c.name}</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>` };
  const nav = '<a href="/pricing">Pricing</a> <a href="/security">Security</a> <a href="/about">About</a> <a href="/customers">Customers</a> <a href="/careers">Careers</a>';
  return {
    [`${o}/`]: page(`${c.name} | Software for modern teams`, `${s.product} ${s.funding ?? ""}`).replace("</main>", `${nav}</main>`),
    [`${o}/pricing`]: page("Pricing", `${s.plan ?? "Simple pricing for every team."} ${s.data ?? ""} ${s.payments ?? ""}`),
    [`${o}/security`]: page("Security", `${s.cert ?? "We take security seriously."} ${s.friction ?? ""}`),
    [`${o}/about`]: page("About", `${s.size ?? "We are a small team."} ${s.eu ?? ""} ${s.health ?? ""}`),
    [`${o}/customers`]: page("Customers", s.logos ?? "Our customers love us."),
    [`${o}/careers`]: page("Careers", s.hiring ?? "Open roles: Account Executive and Designer."),
  };
}

/** The pretend internet: every demo company's pages, served from memory with a public-looking address. */
export function demoFetchDeps(contact = DEMO_INBOX): FetchDeps {
  const routes = new Map<string, string>();
  for (const c of [...DEMO_COMPANIES, ...DEMO_DISCOVERABLE]) for (const [u, html] of Object.entries(demoSite(c))) routes.set(u, html);
  const transport: Transport = async ({ url }) => {
    if (url.pathname === "/robots.txt") return { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from(""), truncated: false };
    const html = routes.get(url.href);
    return html
      ? { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.from(html), truncated: false }
      : { status: 404, headers: { "content-type": "text/html" }, body: Buffer.from("Not found"), truncated: false };
  };
  return { resolve: async () => ["93.184.216.34"], transport, userAgent: botUserAgent(contact) };
}

export function demoHunter(): HunterClient {
  return {
    account: async () => ({ remaining: 38, used: 12, available: 50, unit: "credits", resetDate: null }),
    domainSearch: async (domain) => {
      const c = DEMO_BY_DOMAIN.get(domain);
      const candidates = c?.contacts ?? [];
      return { candidates, creditsUsed: candidates.length ? 1 : 0, total: candidates.length };
    },
    // The stand-in for Hunter Discover: each angle returns the sample companies it would plausibly find, so the merge,
    // the ranking and the clean-up of the list can all be seen working.
    discover: async (filters) => {
      const f = filters as { job_openings?: unknown; keywords?: { include?: string[] } };
      const all = [...DEMO_DISCOVERABLE, ...DEMO_COMPANIES];
      const hiring = Boolean(f.job_openings);
      const regulated = Boolean(f.keywords?.include?.includes("fintech"));
      const pick = all.filter((c) => (hiring ? c.hiring === "security_role" : regulated ? Boolean(c.s.health || c.s.payments) : true));
      const companies = pick.map((c) => ({ domain: c.domain, name: c.name, emailsTotal: c.contacts.length * 4 + 3, emailsPersonal: c.contacts.length * 3 }));
      return { companies, total: companies.length };
    },
  };
}

export interface OutboxMessage {
  at: string;
  to: string;
  subject: string;
  runId: string;
  text: string;
  /** The HTML alternative, when the message has one. */
  html: string | null;
}


export function demoGmail(outbox: OutboxMessage[]): GmailSender {
  const fetchFn = (async (url: string | URL, init: RequestInit) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "demo", expires_in: 3600 }), { status: 200 });
    const raw = Buffer.from((JSON.parse(String(init.body)) as { raw: string }).raw, "base64url").toString("utf8");
    const { head, text, html } = readMessage(raw);
    const header = (name: string) => new RegExp(`^${name}: (.*)$`, "im").exec(head)?.[1] ?? "";
    outbox.unshift({ at: new Date().toISOString(), to: header("To"), subject: header("Subject"), runId: header("X-Outbound-Run"), text, html });
    const id = createHash("sha1").update(raw).digest("hex").slice(0, 16);
    return new Response(JSON.stringify({ id, threadId: id }), { status: 200 });
  }) as unknown as typeof fetch;
  return createGmailSender({ clientId: "demo", clientSecret: "demo", refreshToken: "demo", from: DEMO_INBOX, testTo: DEMO_INBOX, fromName: "Sprinto Outbound (demo)", fetchFn });
}

export interface DemoWorld {
  db: Db;
  users: Record<Exclude<Role, "pending">, string> & { pending: string };
  outbox: OutboxMessage[];
  deps(store: Store): PipelineDeps;
}

const KEY = Symbol.for("sprinto-outbound.demo");
type G = typeof globalThis & { [KEY]?: Promise<DemoWorld> };

/** Builds the demo world once per server process and seeds one finished run, so the first page already has something to read. */
export function getDemo(): Promise<DemoWorld> {
  const g = globalThis as G;
  g[KEY] ??= build();
  return g[KEY];
}

/** The people, settings, sign-off and verified facts file every in-memory world starts from. Shared with the smoke test's dry run. */
export async function seedWorld(db: Db, inbox: string = DEMO_INBOX) {
  const users = {
    admin: await db.createUser("admin@demo.example", "admin"),
    operator: await db.createUser("operator@demo.example", "operator"),
    viewer: await db.createUser("viewer@demo.example", "viewer"),
    worker: await db.createUser("worker@demo.example", "worker"),
    pending: await db.createUser("newcomer@demo.example", "pending"),
  };
  const admin = db.as(users.admin);
  await admin.query("insert into public.settings_versions (test_to, sender_name, sender_title, postal_address, require_approval, reason) values ($1, 'Alex Morgan', 'Growth Lead', '12 Demo Street, Mumbai 400001', false, 'Demo setup')", [inbox]);
  await admin.query("insert into public.icp_signoffs (icp_version_id, note) select id, 'Signed off for the demo' from public.icp_versions order by version desc limit 1");
  const file = { ...SPRINTO_FACTS_SEED, items: SPRINTO_FACTS_SEED.items.map((i) => ({ ...i, verifiedBy: "Demo Admin", verifiedAt: new Date().toISOString().slice(0, 10) })) };
  await admin.query("insert into public.sprinto_facts_versions (content, reason) values ($1::jsonb, 'Verified for the demo')", [JSON.stringify(file)]);
  return users;
}

async function build(): Promise<DemoWorld> {
  const db = await newDb();
  const users = await seedWorld(db);

  const outbox: OutboxMessage[] = [];
  const gmail = demoGmail(outbox);
  const world: DemoWorld = {
    db,
    users,
    outbox,
    deps: (store) => ({ store, ai: demoAi(), fetchDeps: demoFetchDeps(), hunter: demoHunter(), gmail, appUrl: null, now: Date.now, stepBudgetMs: 45_000 }),
  };

  // One finished run to start from.
  const [r] = await db.as(users.operator).query<{ create_run: string }>("select public.create_run($1::text[], 'paste', 'Sample run', '{}'::jsonb)", [DEMO_COMPANIES.filter((c) => c.domain !== UP_NEXT).map((c) => c.domain)]);
  void r;
  await tick(world.deps(new Store(pgPort(db.as(users.worker)))), { source: "browser", maxSteps: 200 });
  // The sample run finished without a person in the loop. From here the demo behaves like the product: a new run pauses for approval.
  await db.as(users.admin).query(
    "insert into public.settings_versions (test_to, sender_name, sender_title, postal_address, require_approval, reason) select test_to, sender_name, sender_title, postal_address, true, 'Approval on' from public.settings_now()",
  );
  // A second, newer run, drafted under the approval rule: it is waiting for a person the moment the demo opens.
  await db.as(users.operator).query("select public.create_run($1::text[], 'paste', 'This week''s list', '{}'::jsonb)", [[UP_NEXT]]);
  await tick(world.deps(new Store(pgPort(db.as(users.worker)))), { source: "browser", maxSteps: 50 });
  return world;
}
