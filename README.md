# Sprinto Outbound

Cold outreach at scale for Sprinto (SOC 2, ISO 27001 and GDPR automation). It starts by **finding companies that look like Sprinto customers** (Hunter Discover, narrowed by the signed-off ICP, each home page checked), or you can paste a list. For each chosen company it reads the public website, decides whether it fits, finds one named decision-maker, picks the two pains that person most likely has, writes a formal email with a hook taken from the site, and, after a person approves it, sends it through Gmail. Every researched company also gets a **discovery-call brief**: why now, talking points with the company's own words as evidence, questions to ask, and likely objections.

**Open it, no sign-in needed: https://sprinto-outbound-eight.vercel.app** A short welcome animation, then you are in the real app as a guest. Search for companies that fit the ICP (Hunter's Discover, free), choose some, and each is read from its real website by Gemini, scored with a quote for every point, matched to a contact by Hunter, and written up with a draft email and a discovery-call card. Guests can do what an admin does: change the ICP and the rules, edit settings, review drafts. Email goes only to the owner's test inbox. See "Guest access" below.

**How it runs:** Vercel in Mumbai, Supabase for data and sign-in, a GitHub Actions worker every 15 minutes and a weekly discovery digest. The owner signs in at `/login` (invite-only magic link); everyone else is a guest.

## Guest access

The app is the same for everyone. Someone who is not signed in becomes a **guest**: the server acts for them through one dedicated admin account whose password lives only in the server's settings (never in the browser or the repository), so a guest sees the real data, including the contacts Hunter found, and can do what an admin does. Switching it on takes the steps in "Deploying" (`npm run guest`). It rests on three rails, because the link is public:

- **A guest cannot manage people** (the People page and role changes), so nobody can lock the owner out.
- **Spending is capped, counted from the database** so it holds across servers: up to 5 companies a run, 25 a day, a daily model-token allowance (400,000), 6 Hunter lookups a day, 12 re-runs or promotions a day, 20 Ask questions a day, and 15 of the owner's Hunter credits are never used by guests. When a cap is reached the page says so and everything already researched stays open to read. All of it can be changed with `GUEST_DAILY_*` and `GUEST_KEEP_CREDITS`. Two requests at the same instant cannot both pass a check (they run one at a time, and a run that still went over is paused before it starts).
- **The settings that govern spending and mail are fixed for guests** at the owner's values (test address, approval, send cap, run size, parallelism, Hunter reserve, token limits, cooldown), so a guest cannot undo the other rails. A guest can still change the sender, the postal address and the wording. Only the owner can lift a do-not-contact entry. A guest can run the digest (which emails the owner) once an hour and the golden set once every six hours, one at a time, and search for companies a few times an hour.
- **Mail only ever goes to the owner's own test address**, which the server fixes. A guest can approve a draft, but it still lands only in the owner's test inbox, and the daily send cap still applies.

Everything a guest does is recorded under the guest account, so it can be told apart from the owner's own work. The sample-only copy of the app (`DEMO_MODE`, invented companies, no keys) is kept for `npm run dev:demo` and as a fallback; it is a separate deployment with nothing real in it.

## Try it now, with no keys

```bash
npm install
npm run dev:demo      # http://localhost:3100
```

Demo mode runs the whole product on eight invented companies, in memory: a real Postgres engine with the real schema, the real worker, the real quote check, scoring, lint and send safety. Only the outside world is pretend (the websites, the model, Hunter and Gmail). Nothing leaves your computer, and it refuses to start beside a real database, or in production unless it is the credential-free public demo. Use the **View as** switch at the top to see what an admin, an operator, a viewer and a not-yet-approved person can each do.

Things worth clicking: **Today** (what needs you now), a company's **Why** page (every score point with its quote and the page it came from), **Needs attention** (a "maybe", a company with no usable contact), **Discover** (find companies, with the reason for each suggestion), **Leads** and a company's **brief** (what to know before the call), **Test inbox** (the formal email as it would land in your Gmail, with the defence under it), and **Settings** (what must be true before anything can send), **Impact** (the funnel, where the rest went, and time saved with its working), **Scorecard** (the three kill criteria set before the build, and where each stands, with "not enough data" until 8 decisions exist), **Quality** (this week against last week, with "not enough data" shown where a sample is too small, and the golden set), **Ask** (plain-English questions answered from the records, with what it looked at shown), and **ICP and replay** (change a weight and see which stored companies would move, without re-reading a single site).

## What exists today

Everything below is built, tested and deployed. The tests use fakes for the outside world; the live app uses the real Gemini, Hunter, Gmail and Supabase, and a first real run (two companies, one promoted, one email approved and sent to the test inbox) has been done. The Status section of [`docs/Sprinto-Outbound-Scope.md`](docs/Sprinto-Outbound-Scope.md) says what that run showed, including the faults only real use found.

| Layer | Where | Notes |
|---|---|---|
| Web guard, scraper | `src/lib/scrape/` | SSRF guard, robots.txt, redirect checks, size and time caps, HTML to text, per-site crawler |
| Gemini client, extraction, agent loop | `src/lib/ai/`, `src/lib/extract/`, `src/lib/agent/` | Model fallback chain, JSON and function calling kept separate, injection handling, token budgets |
| ICP score, contact ranking | `src/lib/icp/`, `src/lib/contacts/` | Versioned rubric, five gates, explainable ranking, Hunter client with a live credit ledger and cache |
| Discovery | `src/lib/discovery/`, `src/app/(app)/discover/` | Three Hunter Discover angles (hiring, B2B software, regulated markets) built from the ICP, merged and ranked, each home page checked so hotels and dead sites drop out, with the standing of anything already known (researched, suppressed, mailed) |
| Today, board, go-live | `src/app/(app)/page.tsx`, `leads/`, `golive/`, `src/lib/app/{stages,today,lead-query,lead-export,learning,notices}.ts`, `src/lib/golive/` | Today is the home page (drafts to approve, follow-ups due, new from the digest, what is running). Leads has a board you can drag cards across, search, filters, sort and saved views, and CSV and HubSpot exports. The brief prints as a call sheet, lists the other people worth speaking to with a different angle for each, and can pay a credit to check an address. Go-live readiness checks the sending domain's SPF, DKIM and DMARC and the sender's setup. What is working compares outcomes against the ICP once enough are recorded |
| Hunter size hint | `src/lib/icp/hints.ts`, `supabase/migrations/…001500_prospect_hints.sql` | Hunter Discover is searched one size band at a time, so each company is known by its band. A run started from Discover carries that band in; the scorer uses it only when the site states no size, labels it as Hunter's, gives it medium confidence, and shows it on the Why page |
| Weekly digest | `src/lib/digest/`, `src/app/(app)/digest/`, `.github/workflows/digest.yml` | A saved search runs every Monday (a scheduled job, or "Run it now"), keeps only companies that are new (not researched, suppressed, mailed, or shown in an earlier digest), emails the owner a short formal note and records it. Free: no Hunter credits, no model, no company contacted |
| Outcomes | `src/lib/app/outcomes.ts`, `src/app/(app)/leads/` | A person records what came of each lead (reached out, replied, meeting booked, not interested, bounced, wrong person), with a note and a follow-up date; the Leads page shows where each stands and who needs a follow-up, and Impact reports replies and meetings as shares of the companies reached |
| Call brief, Leads | `src/lib/brief/`, `src/lib/app/leads.ts`, `src/app/(app)/leads/` | Built by code from recorded evidence (no extra model call): fit with quotes, **where the company stands on SOC 2, ISO 27001, GDPR, HIPAA and PCI DSS** (stated on their site, or labelled as our inference, each with its quote), what that means for the conversation, **how far the score is from the next verdict and which unknowns could move it**, a **call plan** (opener, ordered questions tied to their own words, what to bring, how to close), objections their own evidence makes likely, a **buying-group diagram**, a **score breakdown chart**, and a **measure of how much the brief rests on evidence**. The only thing said about Sprinto is a verified claim, and a framework no verified claim covers is flagged "do not promise". The Leads page adds a **fit spread** chart of every researched company, a **compare view** (tick two to four companies and line them up side by side: who is the stronger fit, and in words where they differ on each framework, contact and conversation), and a **one-page PDF** of any brief to take into the call |
| Pains, draft, lint | `src/lib/pitch/`, `src/lib/email/lint.ts` | Fixed pain library, 12 lint checks, repair loop, held drafts; a formal register (`draft-v4`) |
| Gmail | `src/lib/email/` | Strict MIME builder (multipart: plain text and an escaped, self-contained HTML letter), send-only OAuth, three outcomes (sent, failed, unknown), test notice under the email |
| Database | `supabase/` | Roles, row-level security, append-only history, queue and send safety as SQL functions ([details](supabase/README.md)) |
| Worker | `src/lib/worker/` | The seven steps as handlers, the tick loop, the store over a database port |
| App | `src/app/`, `src/components/` | Sign-in (invite-only magic link), Discover, Leads, runs, paste a list (finds domains in any text), a live run view with a weighted progress bar and time left, a progress card and finish notice that follow you around the app, a first-visit tour, the Why page, settings, people, run CSV export, a command palette |
| Review desk | `src/app/(app)/review/`, `src/lib/app/review.ts`, `editdiff.ts` | A person approves, edits or rejects every draft before it is sent; edits are measured in words and re-checked; each decision is a permanent row (`email_reviews`) |
| Demo | `src/lib/demo/` | The sample world described above |
| Key day | `scripts/`, `src/lib/smoke/` | Hidden-prompt key entry, and the smoke test described below |
| Ask | `src/lib/ask/` | Seven read-only lookups, the loop, the answer check, the rate limit, and the demo stand-in |
| Scorecard | `src/lib/app/scorecard.ts` | The class's kill criteria (rewrites over 50%, contact accuracy under 60%, time costing more than it saves) checked against recorded review decisions, with a minimum sample and the working shown |
| Quality watch | `src/lib/quality/` | Live readings with minimum-sample rules, the golden set of known companies, and its history |

Everything in the scope is built, deployed and has been exercised on real data. The smoke script has been run against the real accounts, and `npm run smoke -- --pipeline domain` is a real end-to-end dry run on one company.

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

## Deploying

1. **Supabase:** follow [`supabase/README.md`](supabase/README.md) (create the project, turn off sign-ups, apply the 17 migrations, promote yourself, create the worker account).
2. **Vercel:** link the repository (region `bom1`, set in `vercel.json`) and set the environment variables listed in [`.env.local.example`](.env.local.example), either in the dashboard or with `npx vercel env add`. A `.vercelignore` keeps uploads to source only (without it the CLI also tries to upload build caches). Deploy with `npx vercel deploy --prod`. Add the live address to Supabase's Site URL and redirect list.
3. **GitHub:** add the repository secrets `APP_URL` and `CRON_SECRET` (the same value as in Vercel). The Worker workflow then calls the app every 15 minutes. Opening a run in the browser also drives the worker, because GitHub's scheduler can run late.
4. **In the app, as admin:** set the test address, sender and a full postal address; sign off the ICP; verify at least one claim about Sprinto against its source. Until all three are done, nothing can send. Every draft then waits for a person's approval (a setting an admin can change, with a reason).
5. **Guest access (optional, for a link anyone can open):** create one more user in Supabase (Authentication, Users, Add user, with "Auto confirm" ticked), then run `npm run guest`. It asks for that user's email and password (the password is typed hidden), prints the one SQL line that makes the account an admin (run it once in the SQL editor), and stores `GUEST_PASS`, `GUEST_EMAIL` and `GUEST_PASSWORD` on the Vercel project. Deploy again and the welcome page and guest access are on. Anyone who wants the owner view signs in at `/login`.
6. **Gmail:** `npm run gmail-token` makes the send-only sign-in. While the Google app is in Testing mode it expires after about 7 days, so renew it (and the copy on Vercel) before any demo. `docs/REHEARSAL.md` has the steps.

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
