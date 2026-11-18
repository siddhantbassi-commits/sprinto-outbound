# Sprinto Outbound

Cold outreach at scale for Sprinto (SOC 2, ISO 27001 and GDPR automation). Paste a list of domains; for each one the system reads the company's public website, decides whether it fits, finds one named decision-maker, picks the two pains that person most likely has, writes a short personal email with a hook taken from the site, and sends it through Gmail.

**Live:** https://sprinto-outbound-eight.vercel.app (invite-only, test mode: mail goes only to the configured test address). Deployed on Vercel in Mumbai, with Supabase for data and sign-in and a GitHub Actions worker every 15 minutes.

**Gemini reads and writes. Code decides.** Every extracted fact carries a verbatim quote that code checks against the stored page text. Scores, verdicts, the choice of person, the lint on the draft and the send safety are all deterministic and tested. Every step writes an append-only trace, and the "Why" page is that trace made readable.

**Test mode only.** The recipient is a server setting. `sendTest` accepts no recipient, so the real contact is never mailed: the email lands in your own inbox with a header above it saying who it *would* have gone to and why.

Built for MESA AI-Native Track, Case 02 (3 November 2026). Scope and reasoning: [`docs/Sprinto-Outbound-Scope.md`](docs/Sprinto-Outbound-Scope.md). Components map: [`docs/Sprinto-Outbound-Components-Map.pdf`](docs/Sprinto-Outbound-Components-Map.pdf).

## Try it now, with no keys

```bash
npm install
npm run dev:demo      # http://localhost:3100
```

Demo mode runs the whole product on seven invented companies, in memory: a real Postgres engine with the real schema, the real worker, the real quote check, scoring, lint and send safety. Only the outside world is pretend (the websites, the model, Hunter and Gmail). Nothing leaves your computer, and it refuses to start in production or beside a real database. Use the **View as** switch at the top to see what an admin, an operator, a viewer and a not-yet-approved person can each do.

Things worth clicking: a company's **Why** page (every score point with its quote and the page it came from), **Needs attention** (a "maybe", a company with no usable contact), **Test inbox** (what would have landed in your Gmail, with the defence above it), and **Settings** (what must be true before anything can send), **Impact** (the funnel, where the rest went, and time saved with its working), **Scorecard** (the three kill criteria set before the build, and where each stands, with "not enough data" until 8 decisions exist), **Quality** (this week against last week, with "not enough data" shown where a sample is too small, and the golden set), **Ask** (plain-English questions answered from the records, with what it looked at shown), and **ICP and replay** (change a weight and see which stored companies would move, without re-reading a single site).

## What exists today

Everything below is built and tested, and the app runs. **No real service has been called yet**: Gemini, Hunter and Gmail are exercised only through fakes.

| Layer | Where | Notes |
|---|---|---|
| Web guard, scraper | `src/lib/scrape/` | SSRF guard, robots.txt, redirect checks, size and time caps, HTML to text, per-site crawler |
| Gemini client, extraction, agent loop | `src/lib/ai/`, `src/lib/extract/`, `src/lib/agent/` | Model fallback chain, JSON and function calling kept separate, injection handling, token budgets |
| ICP score, contact ranking | `src/lib/icp/`, `src/lib/contacts/` | Versioned rubric, five gates, explainable ranking, Hunter client with a live credit ledger and cache |
| Pains, draft, lint | `src/lib/pitch/`, `src/lib/email/lint.ts` | Fixed pain library, 12 lint checks, repair loop, held drafts |
| Gmail | `src/lib/email/` | Strict MIME builder, send-only OAuth, three outcomes (sent, failed, unknown), inbox header |
| Database | `supabase/` | Roles, row-level security, append-only history, queue and send safety as SQL functions ([details](supabase/README.md)) |
| Worker | `src/lib/worker/` | The seven steps as handlers, the tick loop, the store over a database port |
| App | `src/app/`, `src/components/` | Sign-in (invite-only magic link), runs, new run, run detail, the Why page, needs attention, settings, people, CSV export |
| Demo | `src/lib/demo/` | The sample world described above |
| Key day | `scripts/`, `src/lib/smoke/` | Hidden-prompt key entry, and the smoke test described below |
| Ask | `src/lib/ask/` | Seven read-only lookups, the loop, the answer check, the rate limit, and the demo stand-in |
| Scorecard | `src/lib/app/scorecard.ts` | The class's kill criteria (rewrites over 50%, contact accuracy under 60%, time costing more than it saves) checked against recorded review decisions, with a minimum sample and the working shown |
| Quality watch | `src/lib/quality/` | Live readings with minimum-sample rules, the golden set of known companies, and its history |

Everything in the scope is built. The smoke script is built and tested against fakes; it has not yet been run against your real accounts.

## Key day: entering keys and checking they work

```bash
npm run keys        # hidden prompts; writes .env.local (readable by you alone, ignored by git)
npm run smoke       # every check that costs nothing
npm run golden      # read the golden set on the real model (add --scripted to check the harness only)
```

`npm run keys` never echoes a secret, never prints one back, and keeps your existing lines and comments. You can generate the cron secret by pressing `g`.

`npm run smoke` reads `.env.local`, prints names and results only (any key that somehow appeared is replaced with `[hidden]`), and ends in one of three verdicts: **READY** (everything checked and fine), **NOT FINISHED** (nothing failed, but something was not checked or is worth a look) or **NOT READY** (something failed). What it settles that could not be known before the keys existed:

| Section | What it proves |
|---|---|
| network | The scraper's real transport works from this machine, and the guard refuses the metadata address, loopback and private ranges |
| gemini | Which model names really exist for your key, which answer in JSON-schema mode, whether `nullable` with `enum` is accepted, that a real extraction survives the quote check, and that function calling works |
| hunter | The key works, the live credit balance, and how many domains it covers after the reserve |
| gmail | The refresh token works and is send-only (and a reminder about the 7-day limit on External apps in Testing) |
| supabase | An anonymous visitor reads nothing; the worker can sign in with the worker role; the migrations are applied; the recorded test address matches `OUTBOUND_TEST_TO`; an ICP is signed off; the facts file is verified; no service-role key is lying around |

Things that cost something or send something are off until you ask:

```bash
npm run smoke -- --send                       # sends ONE test email to your own test address
npm run smoke -- --hunter-search acme.com     # one real Hunter search (can spend a credit; checks the seniority words)
npm run smoke -- --pipeline acme.com          # a dry run on one real company: real site, real model, nothing sent
npm run smoke -- --pipeline acme.com --real-hunter   # ... with a real Hunter lookup too
npm run smoke -- --only gemini,gmail          # just those sections
```

The dry run reads a real company's real site and asks the real model, in a throwaway in-memory database, and shows what the system made of it (the pages, the facts and how many quotes checked out, the score, and the email it would have written) without involving Supabase, Gmail or any account of yours.

## Deploying (when you have the accounts)

1. **Supabase:** follow [`supabase/README.md`](supabase/README.md) (create the project, turn off sign-ups, apply the migrations, promote yourself, create the worker account).
2. **Vercel:** import the repository, region `bom1`, and set the environment variables listed in [`.env.local.example`](.env.local.example) through the dashboard.
3. **GitHub:** add the repository secrets `APP_URL` and `CRON_SECRET` (the same value as in Vercel). The Worker workflow then calls the app every 15 minutes. Opening a run in the browser also drives the worker, because GitHub's scheduler can run late.
4. **In the app, as admin:** set the test address, sender and postal address; sign off the ICP; verify at least one claim about Sprinto against its source. Until all three are done, nothing can send.

## Running the checks

```bash
npm run check      # typecheck, then every test
npm run build      # a production build
```

The database tests run the real migrations on [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly), so row-level security, the append-only guards and the queue functions are tested for what they actually do. The whole suite takes a couple of minutes.

## Keys

None are in this repository, and none should ever be pasted into a chat. They go into Vercel's server environment through its dashboard (or a hidden prompt). The browser never receives a key: the only public values are the Supabase URL and its anon key, which are public by design and protected by the database's own rules.

## The quality watch

Two different things, kept apart on purpose.

**Live readings** (`/quality`) are measured on real work: quotes the model gave that were not on the page, sites that could not be read, pages with too little text, qualification rate, person-found rate, drafts passing all 12 checks first time, retries, time and tokens per company, which model and prompt are in use, sends of unknown result, and the worker's heartbeat. Each is shown for the last 7 days against the 7 before. Every reading has a minimum sample (and rates counted per quote, page or step also need at least 8 companies behind them). Below it the reading says **Not enough data** and shows no figure, colour or trend, and the overall banner says how many readings could not be judged, so a quiet system never looks like a healthy one.

**The golden set** is 10 invented companies whose answers we know, including traps (a number that is not the headcount, "not yet certified", a competitor's badge, a page that tells the model what to say, a page with almost nothing on it). The model reads them through the real extraction and quote check, and the result is compared with the truth: facts read correctly, read wrongly (the worst kind), asserted when no page says so, and whether the verdict matched. The expected verdict is computed by the real scorer from the known truth, never typed in. It runs:

- in the test suite, against a scripted stand-in that answers from the truth, together with degraded stand-ins (wrong facts, dropped facts, an obedient model) to prove the harness would notice a model that got worse. This proves the harness works. It says nothing about the real model;
- on demand from the Quality page (operators and admins), and weekly from `.github/workflows/golden.yml`, which calls `/api/worker/golden` and fails the job (so GitHub emails you) if the real model got worse;
- from the command line with `npm run golden`, which exits 1 on a warning or failure so it can gate a model or prompt change.

Only a run on the real model counts as a measurement; a stand-in run is labelled "not a measurement" everywhere it appears. Each run is kept in `golden_runs` (append-only) with the model, prompt and ICP version it ran under. The page warns if the model or extraction prompt in use has not been through a real golden run, or if none has run for 8 days.

What it cannot tell you: the companies are invented, so it detects drift in how the model reads, not how well the system does on the real market. The thresholds are starting points to tune against real weeks.

## Ask

Ask answers plain-English questions about what the system did ("who is waiting for a person?", "why was this company not a fit?"). It is read-only by construction:

- Gemini chooses among **seven fixed lookups** and writes the answer. Code checks every argument (lane and verdict from lists, domains by pattern, ids as ids, limits as small integers), runs the lookup as the signed-in person's own database session, and caps what comes back. There is no SQL tool and no tool that writes.
- The model never receives a contact's name or address, even for an admin: only a role, seniority and confidence.
- Lookup results contain text copied from websites, so they reach the model as delimited data under a standing notice, and instruction-like text is flagged beside the evidence.
- An answer with no lookup behind it is refused, so "send them all" or a guess from general knowledge cannot come back as an answer.
- Code then checks the answer against the lookups: any company or number it names that no lookup returned is flagged for the reader. It cannot tell the model's own arithmetic from invention, so a computed percentage is flagged too.
- Limits: 500 characters per question, up to 4 rounds of at most 3 lookups, a fixed token budget per question, 10 questions per 10 minutes and one at a time per person. The counter lives in server memory, so on a serverless host it is a speed bump, not a billing guarantee; the token budget is the hard ceiling.
- Each question stands alone; Ask keeps no memory of earlier ones.

In demo mode a keyword matcher stands in for the model (and says so on the page); the lookups, checks and limits are the real ones.
