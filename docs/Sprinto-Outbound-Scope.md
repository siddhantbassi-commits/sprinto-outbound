# Sprinto Outbound: Scope

### MESA AI-Native Track · Case 02 · "Cold Outreach, at Scale" · 3 November 2026

Working name: **Sprinto Outbound**. Companion file: [Sprinto-Outbound-Components-Map.pdf](Sprinto-Outbound-Components-Map.pdf) (the one-page map; every number below matches it).

**How to read the tags.** **[Case]** is a fact from the brief. **[Research]** is something I looked up (sources in section 19). **[Assumption]** is my choice, to be confirmed or replaced. Everything else is design.

---

## 0. Read this first

**What we are building.** A pipeline you run on a list of domains. For each domain it reads the company's public website, works out whether the company fits Sprinto, finds one named decision-maker, picks the two pains that person most likely has, writes a short personal email with a hook taken from the site, and sends it through Gmail. Around the pipeline sits a small platform: sign-in, a run page, a "why" page for every company, a versioned ICP, budgets, a suppression list, quality checks and downloads.

**The one idea the whole design rests on.** The case's second "done" line is *you can defend every decision the system made: why this company, why this person, why this email*. So the design is built backwards from that sentence:

- **Gemini reads and writes. Code decides.** Gemini turns messy page text into structured facts and writes the draft. A plain TypeScript function turns those facts into a score. Same facts, same score, every time.
- **Every fact carries a quote** copied from the page. Code checks the quote really appears in the stored page text. A fact whose quote cannot be found is thrown away.
- **Every step writes a trace** (inputs, output, prompt version, model, tokens, time). The "why" page is just that trace made readable.

**The safety line (the human boundary).** In test mode, which is the only mode we build, every email goes to *your own inbox*, as the case instructs [Case]. The real contact is recorded and shown at the top of the email ("Would have gone to Priya Rao, CTO"), never mailed. There is no live-send button, because a dead or dangerous button is exactly what we have avoided in every past build.

**What this reuses.** A large part of the platform already exists in Freshroots Ops: sign-in and roles, the app shell and light/dark theme, the Gemini client and loop, rate limiter, security headers and CSP, CSV neutralisation, migration runner, database contract tests, CI and the scheduled GitHub Action. We copy and adapt them (section 14). That is what makes this achievable in the time.

**Decisions I made so we could move. Change any of them.**

| # | Decision | Why |
|---|---|---|
| D1 | Hunter is the primary contact finder; Apollo is a manual-CSV fallback that is always available | The case wants "run it on a list of domains, end to end". Only Hunter has an API. The fallback means a Hunter quota or outage never stops a run |
| D2 | Gmail API with a send-only OAuth scope, not SMTP | Least privilege, no password stored. Needs a one-time token (section 8.4) |
| D3 | Platform, not a script: invite-only sign-in, Supabase, GitHub Actions worker | Matches Freshroots and Clearway quality; the ask says "platform" |
| D4 | Test mode only. `to` is fixed to your address in code | The case says hardcode it [Case]. Also safe |
| D5 | Qualify at 65 of 100; 45 to 64 is "maybe" and waits for a person; under 45 is "not a fit" | The case wants no decisions mid-run, so only clear fits proceed. A person can promote a "maybe" with one click |
| D6 | One Hunter search per domain, cached 30 days, with a hard reserve | Quota is tiny (section 8.3) |
| D7 | Gemini does extraction, page-choosing, pain-picking and drafting. It never scores, never picks a recipient, never sends | Defensibility |

**Questions for you are collected in section 20.** None blocks reading this.

---

## 1. The case, and what "done" is

[Case] Sprinto automates SOC 2, ISO 27001 and GDPR for SaaS companies. The Growth Lead spends 15 to 20 minutes per company on research, finding the person and writing the first email, for 8 to 15 companies a week, and quality drops by the end of the list because the writer is tired.

[Case] The seven steps: (1) scrape, (2) extract structured data, (3) qualify against the ICP, with an agent loop that fetches more when data is thin, (4) find the point of contact, (5) identify the two most likely pains for that person, (6) draft a personalised email addressed by name with a specific hook, (7) send via Gmail to your own address.

[Case] "Done": a personalised cold email lands in your inbox, addressed to a real person by name, with a hook a human would answer; and you can defend every decision.

### Rubric map (what a grader will look for, and where we show it)

| The case says | Where we show it |
|---|---|
| Right companies is *your definition, through research* | Section 3 (the ICP, with sources), Rulebook page, score breakdown on every company |
| Repeatable on a list of domains, no decisions at each step | Run page: paste domains, press Run, walk away; worker drains the queue |
| Agent loop when data is insufficient | Step 3: up to 4 rounds of Gemini choosing which allowed page to fetch; every round is on the trace |
| Right decision-maker | Contact ranking table: every candidate, its score parts, the runner-up |
| Two most likely pains for *that person* | Pain library, persona-weighted, two chosen with evidence |
| Name plus a specific hook | Lint requires the first name and a hook tied to a quote from the site; the quote is shown beside the email |
| Email lands in your inbox | Section 8.4; the inbox copy carries the "why" summary at the top |
| Defend every decision | The Why page, and the header block in every email |

---

## 2. Does this deserve to be built? (the nine checks, short)

Same method as the Freshroots write-up.

| Check | Verdict | Note |
|---|---|---|
| 01 Problem real? | Yes | 15 to 20 minutes per company, and quality decays through the list [Case] |
| 02 Workflow repeated? | Yes | Weekly, 8 to 15 companies [Case] |
| 03 Input available? | Yes, if | Websites are public. Contacts depend on Hunter's coverage and a tiny quota (D6) |
| 04 Output valuable? | Yes, if | A cold email is only worth sending if the hook is specific. That is why hooks must be grounded in a quote |
| 05 Impact measurable? | Yes | Minutes saved per company (we compute it from step times), qualification rate, reply rate once live |
| 06 ROI worth it? | Yes, if | Gemini cost per company should be small, and the usage ledger measures it (we have not measured it yet). Hunter's free quota is the real ceiling |
| 07 Failure risk OK? | **Yes, only with a boundary** | A wrong cold email to a real person is reputational. Boundary: test mode now; live mode needs a deliberate, signed-off change |
| 08 Judgment protected? | Yes, if | Who is worth pursuing and what to say on a reply stay with the Growth Lead; the ICP is hers to edit |
| 09 Owner clear? | Yes | The Growth Lead owns the ICP, the facts file and every override |

**Result: build.** Check 07 is the one that shapes the architecture.

---

## 3. The ICP: which companies are the right fit

This is the part the case leaves to us. [Case] Sprinto's stated ICP is SaaS companies, typically Series A to C, that are preparing for a compliance audit or are under enterprise-customer pressure to certify. Our job is to turn that into things a website can show.

### 3.1 What research tells us

- [Research] Sprinto positions itself as full-stack compliance automation for cloud-hosted companies, covering SOC 2, ISO 27001, GDPR and HIPAA. Its investors describe the target as fast-growing SaaS.
- [Research] Sprinto's own docs describe two plans: Foundation for startups seeking a first certification, and Growth for larger, multi-framework programmes. A separate startup programme (Ignite) is aimed at companies under 10 people pursuing SOC 2 or ISO 27001.
- [Research] Reviews and competitor comparisons place Sprinto strongest with early-stage and mid-market SaaS. Competitors (Vanta, Drata and others) are described as deeper for large enterprises. Treat comparison sites as biased.
- [Research] Customer stories published by Sprinto include small to mid companies (examples seen: Fyle, GeoIQ, Axslogic, MoveInSync). A customer that outgrew its first frameworks (MoveInSync) shows the multi-framework expansion path.
- [Research] Sprinto's own site refused our fetch (HTTP 403), so everything above comes from search results and third parties. **The "Sprinto facts" file (section 6.3) must be checked by you against sprinto.com before anything in it is used in an email.**

### 3.2 The definition

A company is a fit when **all three** are true. Each is something we can measure from a public website.

1. **It sells software to businesses and holds their data** (B2B SaaS or developer or infrastructure product, cloud-hosted).
2. **Its size is where buying a platform beats hiring** (roughly 20 to 500 people; sweet spot 50 to 200). Below about 10 people Sprinto's startup programme applies; above about 1,000 the buyer is a big GRC team.
3. **There is a reason to certify now**: an enterprise motion without visible proof of compliance, or a certification visibly in progress, or a security hire being made.

A company is *not* a fit when it is consumer-facing, an agency or consultancy, a Sprinto competitor, an existing Sprinto customer, or already fully covered (SOC 2 Type 2 plus ISO 27001 on a competitor's trust platform).

### 3.3 The scoring rubric (code, not the AI)

Gemini extracts the facts (step 2). A function scores them. All weights live in a versioned ICP config the Growth Lead can edit with a reason (section 11, ICP page). **These weights are our hypothesis; replay (section 13) is how we test them.**

**Gates** (fail any = "not a fit", with the reason shown)

| Gate | Passes when |
|---|---|
| G1 Product | A B2B software, SaaS, platform, API or developer product is evident |
| G2 Not excluded | Not Sprinto, not on the competitor blocklist, no Sprinto trust-badge (already a customer) |
| G3 Not suppressed | Domain is not on the suppression list |
| G4 Headcount | Estimated band is not above 1,000 (an unknown band passes, and is flagged) |
| G5 Enough to judge | At least 600 characters of text from at least 2 pages. If not, the result is "needs more", not "not a fit" |

**Points (max 100)**

| Group | Signal | Points |
|---|---|---|
| **Fit (40)** | Handles customer data in the cloud: stated 15, implied 8 | 0 to 15 |
| | Sells to businesses: "Enterprise" plan or "contact sales" 5, named business customer logos 5, SSO/SAML/SCIM or audit logs 5 | 0 to 15 |
| | Size band: 51 to 200 = 10; 11 to 50 = 8; 201 to 500 = 6; 1 to 10 = 4; 501 to 1,000 = 2; unknown = 0 | 0 to 10 |
| **Need (40)** | Compliance status: "in progress" = 25; nothing visible = 20; SOC 2 Type 1 only = 15; ISO only = 15; SOC 2 Type 2 alone = 5; SOC 2 plus ISO = 0; unknown = 0 and flagged | 0 to 25 |
| | Framework gap: sells to EU/UK with no GDPR statement 3; health data with no HIPAA mention 3; payments with no PCI mention 2 | 0 to 8 |
| | Hiring for security, compliance, GRC or DevSecOps = 7; Head of IT = 3 | 0 to 7 |
| **Timing (20)** | Funding, launch or enterprise tier within about 12 months | 0 to 8 |
| | Security-review friction visible: questionnaire, "request our security documentation", DPA, request-access trust page | 0 to 7 |
| | New regulated market or region | 0 to 5 |
| **Penalty** | A competitor's trust-centre badge is visible | minus 15 (floor 0) |

**Verdict**

| Score | Lane | What happens |
|---|---|---|
| 65 and above | **Qualified** | Continues to steps 4 to 7 automatically |
| 45 to 64 | **Maybe** | Listed in the review queue. A person can *Promote* (one click, recorded with a reason) |
| Under 45, or a gate failed | **Not a fit** | Stops, with the reason. Kept for replay |
| Missing key facts after the agent loop | **Needs more** | Stops, naming exactly which facts are missing. Never guessed |

Why this is defensible: the breakdown is a list of rows (*signal, points, the quote behind it, the page it came from*). Any row can be questioned and any weight changed.

### 3.4 Companies we want to avoid

Blocklist and rules, all in config: Sprinto, Vanta, Drata, Secureframe, Thoropass, Scrut and similar; consumer apps; agencies and consultancies; auditors and MSSPs (they are channel partners, not buyers); government and education sites; anyone on the suppression list.

---

## 4. The person: who to contact

[Case] "Right decision-maker." The right title depends on company size, because compliance has a different owner at each stage.

| Size band | Likely owner of compliance (best first) |
|---|---|
| 11 to 50 | CTO or technical co-founder; Founder/CEO; Head of Engineering |
| 51 to 200 | Head or VP of Security, CISO, Head of GRC or Compliance; then CTO; VP/Head of Engineering; Head of IT |
| 201 to 500 | CISO; Head of GRC, Compliance or Risk; Director of Security; then VP Engineering; CTO |
| Unknown | Use 51 to 200, and flag it |

### 4.1 Finding candidates

- **Hunter Domain Search** (one call per domain, `type=personal`, `seniority=senior,executive`, the maximum results the plan allows) [Research: Hunter's API takes `domain`, `type`, `seniority`, `department`, `job_titles`, `limit`, `offset`; seniority and department are values from a live list, and an unknown value returns a 400, so a small smoke test pins the exact words before the session].
- **Apollo fallback.** A contacts CSV (domain, first name, last name, title, email) can be uploaded at any time. A manual row always outranks a Hunter row for the same domain, because a human looked it up.
- Candidates are filtered and ranked **in code**, so we do not depend on Hunter's department labels.

### 4.2 Ranking (0 to 100, in code)

| Part | Points |
|---|---|
| Title match for the company's size band (table above) | 0 to 50 |
| Seniority: executive 15, senior 10 | 0 to 15 |
| Email check: Hunter says valid 20; accept-all 8; unknown 3; invalid = excluded | 0 to 20 |
| Hunter confidence: 90 and above 10; 70 to 89 6; under 70 2 | 0 to 10 |
| Personal (not generic) address, first and last name both present | gate |
| Department fits (security, engineering, IT, executive) | 0 to 5 |

Excluded outright: generic addresses (info@, support@), no full name, junior titles, sales, marketing, HR, recruiting, interns.

Ties break the same way every time: higher score, then verified email, then confidence, then alphabetical.

The system writes the explanation itself, from the numbers: *"Chosen: Head of Security (title 50 for a 51 to 200 company, senior 10, email valid 20, confidence 94 gives 10). Runner-up: CTO, 44."*

If nobody qualifies, or the Hunter budget is spent, the company goes to the **review lane: no contact** (where a manual contact can be added).

---

## 5. The pains: what this person most likely feels

[Case] "Identify the two most likely pain points for that person." To keep this defensible and consistent, pains come from a **fixed library**, and Gemini chooses between them. It does not invent.

| ID | Pain | Hits hardest | Signals that raise it (from the facts) |
|---|---|---|---|
| P1 | An enterprise deal is stalling on a missing or ageing security report | Founder, CTO, Sales-led | Enterprise motion, no certification visible |
| P2 | Audit preparation eats engineering time | CTO, Head of Eng | Certification "in progress"; small engineering team |
| P3 | The founder is the accidental compliance owner | Founder, CTO | Under 50 people; no security hire |
| P4 | A second or third framework repeats the same work | CISO, Head of GRC | One certification held; sells to EU, health or payments |
| P5 | Evidence is collected by screenshots and spreadsheets | Head of GRC, CISO | Certification in progress |
| P6 | Repeated security questionnaires from prospects | CISO, Founder | Enterprise sales; no trust centre |
| P7 | Staying compliant after the audit (continuous monitoring) | CISO, Head of GRC | Type 1 held, Type 2 ahead |
| P8 | Hiring a first compliance owner is slow and costly | CTO, Founder | Open security or GRC role |
| P9 | Vendor and third-party risk reviews pile up | CISO | Heavy integrations; sensitive data |

**How two get picked**

1. Code scores every pain: 10 points per matching signal plus a persona weight (0 to 30) for the chosen contact's title. It keeps the top 4.
2. Gemini picks the best 2 of those 4 for *this* person at *this* company and gives one sentence of reasoning for each, citing evidence IDs.
3. Code checks both IDs are in the shortlist and every cited evidence ID exists. If Gemini fails or returns something invalid, the code's top 2 are used and the page says "code fallback".

---

## 6. The email

### 6.1 Shape

Plain text, 70 to 120 words, no images, no tracking pixel, no links in the body.

```
Subject: <6 words or fewer, specific, no hype>

Hi <FirstName>,

<Hook: one sentence about something real on their site, e.g. "I saw {Company} added an Enterprise plan with SSO this quarter.">
<Pain bridge: one or two sentences naming the two pains in this person's own language.>
<Proof: one sentence from the vetted Sprinto facts file. Nothing else counts as proof.>
<Ask: one small question, e.g. "Worth 15 minutes next week to see how teams in your spot get to audit-ready?">

<Sender first name>
<Title>, Sprinto

If this isn't relevant, reply "no" and I won't write again. <Postal address>
```

### 6.2 Inbox header (test mode only)

Above the email, separated by a rule, the owner sees the defence in a few lines: *Would have gone to Priya Rao, CTO at Acme (email verified, confidence 94). Qualified 78/100: strong enterprise signals (quote), certification in progress (quote). Chosen over: CTO, 44. Pains: P1, P2. Hook source: acme.com/pricing. Open the full trace: link.* This is the "defend every decision" line, delivered in the inbox.

### 6.3 The Sprinto facts file

A short, versioned, editable file of the only things the email may say about Sprinto (frameworks supported, who it is for, a proof point), each with a source URL and the name of the person who verified it. Gemini is told the file is the only source of claims about Sprinto. Code rejects any number or claim in a draft that is not in the file. Seeded from research (frameworks; target audience; plan tiers; a public customer example); **you verify it before first use** (section 3.1).

### 6.4 The lint (code, not the AI)

A draft is sent only if every check passes.

| # | Check |
|---|---|
| L1 | 60 to 130 words; subject at most 60 characters, no ALL CAPS, no fake "Re:" or "Fwd:" |
| L2 | Greeting uses the contact's first name exactly as stored |
| L3 | Company name appears |
| L4 | A hook is cited (`hook_evidence_id`), that evidence exists, and the body reuses at least two content words from its quote |
| L5 | Exactly one question mark (one ask) |
| L6 | No links, no emoji, no exclamation marks |
| L7 | Every number and claim about Sprinto appears in the facts file |
| L8 | No claim about a source we did not use ("saw your LinkedIn post", "heard your podcast") unless that source is in the evidence |
| L9 | Banned phrases absent ("hope this finds you well", "just following up", "game-changer", "guarantee", and so on) |
| L10 | Opt-out line and postal address present |
| L11 | No line breaks or control characters in subject or name (header injection) |
| L12 | Contains none of the model's own scaffolding ("As an AI", markdown fences, placeholders like `[Name]`) |

A failed draft gets up to **2 repair attempts**, with the exact lint errors given to Gemini. Still failing: the email is **held** (shown with the reasons), never sent.

---

## 7. The pipeline, step by step

Each domain moves through a fixed state machine. Every transition writes a trace row.

```
queued ─► scraped ─► qualified ─► contact_found ─► pains_chosen ─► drafted ─► sent
   │          │          │ (extract + agent loop run here)  │                │         │
   │          └──────────┴─► not_fit / needs_more / review  └─► no_contact   └─► held  └─► unknown (see 7.7)
   └─► skipped (suppressed, or mailed in the last 30 days)                failed (after 3 retries, with the error)
```

*Built differently from the first sketch:* extraction and qualification are one step, because the agent loop re-extracts each time it fetches a page, so a separate "extracted" state would never be resting. A 'maybe' (45 to 64) is parked in **review** for a person to promote; "needs more" and "no contact" are lanes, not errors.

### 7.1 Step 1: Scrape

- **Input**: a domain. **Output**: stored page texts.
- Normalise (lowercase, IDNA, strip scheme and path); reject IP addresses, `localhost`, and anything that is not a real public hostname.
- Fetch the home page, then up to 5 more by priority: about, pricing, security or trust, customers, careers. Pages are found from the home page's own links, the sitemap, and a short list of common paths.
- Politeness: obey `robots.txt`; a named user agent with a contact address; 3 pages at a time; 8 second timeout; 1.5 MB cap; HTML only.
- Keep badge text (images' alt and title in headers and footers carry "SOC 2" and "ISO 27001"), JSON-LD and meta tags, drop scripts, styles and nav chrome.
- JavaScript-only sites: we do not run a browser (see Known limits). If the text is under 400 characters the page is marked "thin" and the agent loop or "needs more" handles it.
- Stored: URL, status, size, SHA-256, text (capped), time.
- Defences: the SSRF guard (section 12). Each redirect hop is re-checked; redirects must stay on the same registered domain.

### 7.2 Step 2: Extract

- Gemini, JSON-schema output, temperature 0, page text as delimited data.
- Output: the fact fields (product type, audience, customer data, headcount band and how it was estimated, enterprise signals, compliance status and vendor, open security roles, frameworks mentioned, regulated markets, launch or funding signals), each with `value`, `confidence` and `quotes[]` (verbatim, at most 200 characters each).
- **Grounding check (code)**: every quote must appear in the stored page text after whitespace normalisation. A fact with a missing quote becomes "unknown" and increments a grounding-failure counter (shown on Quality watch).
- **Absence facts are decided by code, not by the model** *(found while building)*. "No certification visible", "no compliance vendor" and "no open security role" cannot carry a quote, so the grounding check would discard them. Instead the model may *suggest* one, and it stands only if the stored text really contains none of the markers (SOC 2 / ISO 27001 wording, a competitor's name, a security-role title) and enough was read (two pages; a careers page for the hiring fact). A contradicted suggestion is rejected and shown on the Why page.
- **What grounding does not prove**: that a quote exists on the page, not that the page is telling the truth. A page that plants the very words it wants quoted will ground them. The defences are the injection flag on the Why page and that a company's claims about itself are the evidence we were asked to read.
- An injection scan flags page text that tries to instruct the model; the page is still treated only as data, and the flag is shown on the Why page.

### 7.3 Step 3: Qualify (with the agent loop)

[Case] "with an agent loop to fetch more information when the initial data is insufficient."

1. Code computes **coverage**: which of the six key facts are known with at least medium confidence (product, size, enterprise signal, compliance status, security hiring, customer data).
2. If coverage is below 5 of 6 and fewer than 4 rounds have run, Gemini is called with function calling and the list of unknown facts. It may call only these tools, all executed by our code:

| Tool | What it does | Guard |
|---|---|---|
| `fetch_page(path)` | Fetches one more page on the same domain | Path must be in the discovered list or the fixed candidate list |
| `search_site(terms)` | Searches the already stored text and sitemap titles | No outside search |
| `check_trust_center()` | Tries `/trust`, `/security` and the trust sub-domain patterns we list | Same SSRF guard |
| `list_open_roles()` | Careers page, and the company's own linked job board | Job-board hosts from an allow-list, and only if linked from the company's site |
| `stop(reason)` | Ends the loop | |

3. After each round, code re-runs extraction on new pages and recomputes coverage.
4. The loop ends when coverage is met, 4 rounds are used, the 60,000 token budget for the domain is hit, or Gemini says stop.
5. **Code then scores** with `scoreIcp(facts, icpVersion)`. If key facts are still missing the lane is **needs more**, naming them. Never a guess.

Each round (what was asked, which tool, what came back) is a row on the trace, so a reviewer can see why the system went to the careers page.

### 7.4 Step 4: Find the contact

Section 4. Order: manual contact, else the 30-day Hunter cache, else one Hunter call if the budget allows, else review lane. The response is cached whole. The contact's email never goes to Gemini (data minimisation).

### 7.5 Step 5: Choose the two pains

Section 5.

### 7.6 Step 6: Draft

Gemini gets: the contact's first name and title, the company card, the two pains and their evidence, the facts file, and the lint rules in plain words. It returns `subject`, `body`, `hook_evidence_id`. Code lints (6.4). Up to 2 repairs, then hold.

### 7.7 Step 7: Send

- Build the message with strict header handling; encode the subject; plain text.
- `sendTest(draft)` **takes no recipient**. The `To` address comes only from the server setting `OUTBOUND_TEST_TO`. There is no code path where a contact's address becomes a recipient.
- Gmail API `users.messages.send` using a refresh token with the send-only scope.
- **No double sends.** Before calling Gmail the system inserts a `sending` row guarded by a unique index. If Gmail confirms, the message ID is saved. If the call times out in a way that could have sent, the row becomes **unknown** and is *not* retried: it goes to Needs attention with the header to search for in Sent (`X-Outbound-Run`). A clear failure (bad token, 4xx) is retried up to 3 times with backoff, then held.
- Caps: 20 sends a day and one per domain by default (settings). The cap is enforced by a database function, so a bug cannot exceed it.

---

## 8. Architecture

### 8.1 The shape

```
Growth Lead ──► paste / CSV (checked in the browser) ──► Supabase: run + one prospect per domain
                                                              │
        ┌──────── GitHub Actions every 15 min (curl) ─────────┤
        └──────── live Run page (browser polls) ──────────────┤
                                                              ▼
                                           Vercel: /api/worker/tick  or  /api/runs/[id]/advance
                                                              │  claims ONE step of ONE prospect
                                                              ▼
              scrape ─► extract(Gemini) ─► agent loop(Gemini) ─► score(code) ─► Hunter ─► pains ─► draft(Gemini) ─► lint ─► Gmail
                                                              │
                                  every step appended to the trace (Supabase, append-only)
                                                              ▼
                       Why page · Run funnel · Needs attention · Quality watch · CSV downloads · Ask Outbound
```

### 8.2 What each service is for

| Service | Role | Notes |
|---|---|---|
| **GitHub** | Source, CI, scheduled worker | CI runs typecheck, lint, tests, build, browser smoke tests. A cron workflow calls the worker every 15 minutes and loops until the queue is empty or about four minutes pass [Freshroots experience: GitHub's scheduled runs can start late or not at all, so the Runs page warns if there has been no tick for an hour, and opening a live run also ticks] |
| **Vercel** | The Next.js app and the worker endpoints | Region `bom1`. Every endpoint does **one step** and finishes in well under 60 seconds, so the plan's function time limit never matters. All third-party secrets live only here |
| **Supabase** | Postgres, Auth, row level security | Invite-only. No service-role key in the app; the worker signs in as its own account (the pattern Freshroots uses for its scheduler) |
| **Gemini** | Extraction, page-choosing, pain-choosing, drafting, Ask Outbound | Key held only on the server. A model fallback chain of its own, pinnable with `GEMINI_MODEL`; names checked against Google's model page, behaviour confirmed with the key |
| **Hunter** | Contact search | One call per domain, cached, budget read from Hunter's own account endpoint |
| **Gmail** | Sending | Send-only scope |

### 8.3 Budgets (they decide what the system may do)

- **Hunter.** [Hunter's published OpenAPI spec, checked 4 Nov 2026] `GET /v2/account` returns `data.requests.credits.{used, available, remaining}` when the team has a single credit pool (otherwise `searches`), a domain search costs 1 credit and only when it returns at least one result, and every search response carries an `X-Credits-Used` header. The API key can go in an `X-API-KEY` header, so it is never in a URL. The case says 25 searches a month [Case]. Hunter's pricing page now lists 50 credits a month for free accounts, and a search costs credits per email found [Research; they disagree]. We therefore **ask Hunter how many credits remain** (its account endpoint, cached for 10 minutes) and keep a reserve of 3. A run is refused or trimmed with a message when it would breach the budget, and the New run page shows the estimate before you press Run.
- **Gemini.** 60,000 tokens per domain, 400,000 per run (editable). A domain over budget stops as "needs more" with the reason.
- **Gmail.** 20 a day.

### 8.4 Gmail set-up, and the trap

You do this once before the session (about 10 minutes): create a Google Cloud project, enable the Gmail API, configure the consent screen, create an OAuth client, run our one-off `npm run gmail:token` helper to get the refresh token, then put it in Vercel.

- [Research] If the consent screen is "External" and in *Testing*, **refresh tokens expire after 7 days**. If your `pg27.mesaschool.co` account is a Google Workspace account, choose **Internal** and the limit does not apply. If it is not, re-run the helper before each demo.
- Fallback if OAuth blocks us on the day: Gmail SMTP with an app password (only if the account allows it). The send function sits behind one interface, so swapping is a half-hour change.

### 8.5 The queue

A table of prospects with a `step`, a `lane` ("active" while moving, otherwise where it ended up), `attempts`, a lease and `next_run_at`. `claim_next_prospect()` takes the next due prospect with row locking (skip-locked), under an advisory lock so the in-flight count and the claim are one decision. The lease is 2 minutes, so a crashed worker's prospect simply becomes claimable again; up to `max_parallel` (3) can be leased at once; a paused run is skipped. Nothing else can move a prospect: `advance_prospect`, `park_prospect`, `fail_prospect` and the email functions each check the caller holds the lease and that the prospect is on the step the caller says it is, so a replayed or stale call is refused (`lease_lost`, `step_mismatch`). Failures retry after 30 and then 60 seconds and land in **failed** with the error on the third (a refused key fails at once). A person puts a parked prospect back with `resume_prospect`, which records a decision with a reason. The prospects table is mutable by design (it is working state), but only through those functions; the history is the append-only trace.

---

## 9. Data model

Row level security on every table; no anonymous privileges. "Append-only" means no update, delete or truncate for anyone, including admins and the service role.

| Table | Purpose | Append-only |
|---|---|---|
| `profiles` | Person, role: pending, viewer, operator, admin | no |
| `settings_versions` | Test-mode address, sender name and title, postal address, caps, thresholds, time-saved assumption | yes (new version each change, with reason) |
| `icp_versions` | The rubric (weights, gates, blocklist) | yes |
| `icp_signoffs` | Who signed which ICP version, when | yes |
| `sprinto_facts_versions` | The facts file | yes |
| `runs` | One per paste or CSV; ICP, facts and prompt versions it used | yes |
| `prospects` | One per domain per run; current step, lane, lease, last error, score | no (working state) |
| `step_events` | The trace: step, status, input hash, output, model, prompt version, tokens, latency, error | yes |
| `pages` | URL, status, size, SHA-256, text, fetched at | yes |
| `facts` / `evidence` | Extracted facts and their verified quotes | yes |
| `scores` | Score, parts, gates, verdict, missing facts, ICP version (replays add rows) | yes |
| `contacts` | Candidates with rank parts, which was chosen, source | yes |
| `hunter_cache` | Whole response per domain | yes (new row on refresh) |
| `emails` | Draft, lint result, attempt, status, Gmail message id | status changes via function only; drafts append-only |
| `suppressions` | Domain or address, reason, who. Lifting is a new row | yes |
| `decisions` | Promote, skip, re-run, mark reply, mark bounce, do not contact, each with a reason | yes |
| `usage_ledger` | Hunter, Gemini and Gmail units per prospect | yes |

**Where the build departs from the table above**

- `facts` holds the extracted facts and their verified quotes together (the quotes live inside the facts), so there is no separate `evidence` table.
- The pain choice is stored in the `step_events` row for the pains step (shortlist, picks, evidence, and whether the code fallback was used), not in a table of its own.
- Added: `manual_contacts` (hand-picked contacts, keyed by domain, so they can exist before a run does) and `worker_ticks` (the heartbeat).
- `suppressions` and `decisions` carry a sequence number. "The newest row wins" uses it rather than the clock, because two rows written in one transaction share a timestamp (this was a real bug, found by a flaky test).
- **Replay** (`/icp`) re-scores every stored company from its latest facts under a draft ICP and shows who moves, saving nothing; it does not write the `scores.replay` rows the data model reserved. The qualify step now records how much text and how many pages it read, so the reading-enough gate can be replayed faithfully. Replay first scores the current version and reports how many recorded verdicts it reproduces, and how many of the rest were scored under an older version.
- **Time saved** is baseline minus review time. `settings_versions.minutes_saved_per_email` is the manual baseline per company researched, and `review_minutes_per_email` and `review_minutes_per_decision` (migration 000800) are the person time subtracted. All three are assumptions shown beside the answer; machine time is reported separately and never counted.
- The sender name, title and postal address live in `settings_versions` (versioned, admin-only), not in the Sprinto claims file, so there is one source for each.
- `settings_versions.test_to` is the recorded test address. The server also has its own `OUTBOUND_TEST_TO`; a send is refused unless the two agree, so changing the address needs both an admin and a deploy.

**Guarantees in the database (not only in the app)**

- Run, step, score and decision rows are written only by functions that stamp time and person; callers cannot back-date or impersonate.
- A unique index allows only one email in `sending`, `sent` or `unknown` per prospect.
- `reserve_send()` enforces the daily cap and refuses when over.
- Owner (the Growth Lead), role checks and ICP version come from stored rows, not from the caller.
- Personal data (contact name and email) has a retention rule: a scheduled function removes it after 90 days, keeping the decision trail without the address.

---

## 10. The AI layer

### 10.1 Calls

| # | Purpose | Mode | Temp | Validated by | If it fails |
|---|---|---|---|---|---|
| 1 | Extract facts | JSON schema | 0 | Enum check, quote-in-page check | Retry once, then "needs more" |
| 2 | Choose what to fetch next | Function calling | 0.2 | Tool arguments checked against allow-lists | End the loop |
| 3 | Choose 2 of 4 pains | JSON schema | 0.2 | IDs in shortlist; evidence IDs exist | Code's top 2 |
| 4 | Draft the email | JSON schema | 0.6 | The 12 lint checks | 2 repairs, then hold |
| 5 | Ask Outbound (answers questions) | Function calling, read-only tools | 0.2 | Tool results only | Plain error |

JSON-schema output and function calling are **kept in separate requests**. [Research] They are reported to clash on some Gemini models, so we never rely on both in one call.

### 10.2 Rules

- Prompts live in versioned files; the version is stored on every step it produced.
- Page text is passed inside a delimiter containing a random token and is described to the model as untrusted data.
- Gemini never receives email addresses, passwords or keys. It receives a contact's first name and title only.
- The model cannot affect the recipient, a score, a verdict or any database write. Its outputs are validated by code before use.
- Rate limit and "one in flight per user" gate (reused from Freshroots); per-domain and per-run token budgets; a time budget that stops with a plain message.
- Every response is logged with tokens, latency and model, so cost is visible on Quality watch.
- Tests use a **scripted fake Gemini client**, as in Freshroots, so the suite is offline and repeatable.

---

## 11. The product: pages

One shell, one design system (the Freshroots tokens: dark by default with a light theme, a single accent, colour kept for meaning, phone-width layouts, visible keyboard focus, reduced motion respected). New accent colour so it reads as its own product. Colour meaning: green = qualified or sent, amber = needs a person, red = failed or blocked, blue = information.

**The "no dummy buttons" rule.** Every control either works or is not shown. Things that are off are shown as *status* (a "Test mode" chip with a sentence), not as disabled buttons. We enforce it with a lint rule against `<button>` without an action and a browser sweep that clicks every control on seeded data.

Every page has a loading skeleton, an empty state that says what to do, and an error state that says what happened.

| Page | What it is for |
|---|---|
| **Runs** (home) | "Needs attention" first: failed steps, held emails, unknown sends, Hunter or Gemini budget low, Gmail token about to expire, no tick for over an hour. Then the latest run's funnel, and what is going fine |
| **New run** | Paste or upload domains. Checked in the browser (format, duplicates, suppressed, mailed in the last 30 days, over the cap), each refused row explained. Shows the estimate (Hunter searches, Gemini calls, minutes) *before* Run. Optional manual contacts CSV |
| **Run detail** | Live table: domain, a 7-step progress strip, score, contact, lane. Tabs: Sent, In progress, Maybe, Not a fit, No contact, Held, Failed |
| **Why (a company)** | The defence page. Timeline of the 7 steps. *What we saw*: pages and highlighted quotes. *Score*: bars per signal with the quote and page. *Why this person*: all candidates, parts, runner-up. *Pains*: the shortlist and the two chosen. *Email*: the draft, the lint checklist, the hook's source. *Send record*. A collapsed raw trace. Actions: Promote, Skip, Suppress, Re-run from a step (adds a new version, never edits), Copy "why" as text |
| **Review queue** | Maybe, no contact, held and needs-more companies with one-click Promote or Skip, each with a reason. Add a manual contact here |
| **ICP and Rulebook** | The rubric in words and as editable weights. Every change is a new version with a reason and a diff. A person signs it off. **Replay**: re-score every stored company under a draft ICP, without re-fetching, and see who moves lane (nothing saved until you choose to) |
| **Pitch settings** | Sprinto facts file (versioned), the pain library, sender name, title and postal address, the test-mode address, the email preview on a sample |
| **Contacts and budgets** | Hunter and Gemini budgets and spend; the 30-day cache; manual contact import |
| **Quality watch** | Grounding failure rate, scrape failure rate, thin-page rate, qualification rate, contact hit rate, first-pass lint rate, tokens and time per company, the golden-set result. A reading without enough data says so rather than looking fine |
| **Weekly report** | Companies researched, qualified, emailed; time saved with its working (manual minutes minus system and review minutes); copyable and printable |
| **Downloads** | Eight CSVs: runs, prospects, evidence, contacts (admin only, emails masked otherwise), emails, suppressions, usage, decisions. Text is neutralised so a spreadsheet cannot run it as a formula |
| **Ask Outbound** | Plain-English questions ("why did we skip Acme?", "who is in the maybe lane?") through read-only tools, with the evidence shown. It changes nothing |
| **People** | Admins approve accounts and set roles |
| **Help** | Plain-language guide to every page, the lanes, the roles and what to do when something looks wrong |

**Roles.** Waiting for approval sees nothing; Viewer reads; Operator runs, promotes, edits settings and facts; Admin also manages people and exports contacts. Nobody becomes admin by signing up.

---

## 12. Defences

| Threat | Defence |
|---|---|
| **SSRF** (a domain that points to our network, cloud metadata or localhost) | Resolve first, then connect to the resolved address; block private, loopback, link-local, metadata and IPv6-mapped ranges; re-check every redirect hop; same registered domain only; no non-HTTP schemes; size and time caps |
| **Prompt injection** from a page | Page text is delimited untrusted data; no tool can send mail or write data; tool arguments are allow-listed; outputs are schema-validated; injection phrases flagged and shown |
| **A made-up hook or claim** | Quote must exist in stored text; lint rejects unsourced Sprinto claims and unsourced "I saw..." claims |
| **Email to the wrong person** | Recipient is a server setting; `sendTest` accepts no recipient |
| **Header injection** | Subject and name stripped of line breaks and control characters; a message builder, not string concatenation |
| **Double send** | Unique index plus an `unknown` state that never auto-retries |
| **Runaway cost or quota burn** | Hunter reserve, per-domain and per-run token caps, daily send cap, run size cap, rate limit |
| **Secrets leaking** | Keys only in Vercel server env; never in the browser, logs or traces; no service-role key anywhere; keys entered by hidden prompt, never pasted into chat |
| **Unauthorised access** | Invite-only; roles; row level security; anon role has no privileges |
| **Tampering with history** | Append-only tables; stamps by the database |
| **Spreadsheet formula injection** | CSV neutralisation (reused) |
| **Personal data** | Minimum collected; emails never sent to Gemini; masked in CSV; 90-day retention; suppression list |
| **Compliance of the emails themselves** | Opt-out line, postal address, no tracking pixel, suppression honoured. (A compliance company's outreach should be compliant) |
| **Scraping manners** | robots.txt obeyed; named user agent; low concurrency; public pages only; no login walls, no LinkedIn |
| **Web security** | CSP, HSTS, no framing, nosniff, referrer policy (reused); same-origin form actions |
| **Outages** | Gemini down: queue waits and retries, nothing is sent half-finished. Hunter down or out of budget: manual contacts and review lane. Gmail token expired: Needs attention, not silent failure |
| **Silent staleness** | Needs attention flags a worker that has not ticked; the page never shows an all-clear when it did not look |

---

## 13. Beyond the case

**Tier 1: part of "done"** (built in the first pass)
1. The Why page with grounded quotes
2. Deterministic, versioned ICP with a score breakdown
3. Hunter budget, cache and manual fallback
4. Test-mode lock and the "would have gone to" inbox header
5. The 12-check lint and the hold lane
6. Suppression list, opt-out line, 30-day repeat guard
7. Run funnel and drop-off reasons
8. Needs attention list

**Tier 2: if time allows**
9. **Replay** of a different ICP on stored facts (what-if, nothing saved)
10. **Quality watch** with a golden set of known companies, also run in CI and weekly
11. **Review queue** with one-click promote and skip
12. **Ask Outbound**
13. **Weekly report and time-saved ledger**
14. Injection flag on pages
15. Subject-line variants stored for later testing

**Tier 3: roadmap, said out loud in the demo, not built**
16. Going live: a checklist and signed-off setting, a warm-up plan, a domain reputation check
17. Reply detection (needs a read scope, so a separate decision) that auto-suppresses
18. Follow-ups on day 3 and 7, drafted and approved by a person
19. Finding new domains from lookalikes of Sprinto's customers
20. CRM push and Slack alerts

---

## 14. Repo, environment and reuse

```
sprinto-outbound/
  src/app/(app)/{runs,new,run/[id],why/[prospectId],review,icp,pitch,budgets,quality,report,downloads,ask,admin,help}
  src/app/api/{worker/tick,runs/[id]/advance,export/[kind],ask,health}
  src/lib/{scrape,extract,icp,contacts,pains,email,send,ai,queue,budgets,csv,auth,supabase}
  supabase/migrations/        append-only history, each file applied once
  scripts/{migrate,contract-live,secret,gmail-token,smoke,make-worker,make-admin}.ts
  tests/ e2e/ fixtures/sites/   saved pages for 10 sample companies
  .github/workflows/{ci,worker,golden}.yml
  docs/{Sprinto-Outbound-Components-Map.pdf,Sprinto-Outbound-Scope.md,DEMO.md}
```

**Reused from Freshroots Ops, adapted:** sign-in, reset, roles and `proxy.ts`; the Shell, theme toggle, `ui.tsx`, skeletons; `src/lib/ask` (Gemini client, loop, rate limit, in-flight gate); `next.config.ts` headers and CSP; CSV export neutralisation; `migrate.ts` and `contract-live.ts`; the PGlite contract-test harness; the `ci.yml` and scheduled workflow patterns; the health endpoint. **Reused from Clearway:** the hidden-prompt secret script, and the "AI reads, rules decide" structure.

**Read first:** Freshroots' `AGENTS.md` warns that this Next.js version has breaking changes. Before writing code, read the docs shipped in `node_modules/next/dist/docs/`.

**Environment**

| Name | Where | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, local | public by design |
| `GEMINI_API_KEY` (and optional `GEMINI_MODEL`) | Vercel | yes |
| `HUNTER_API_KEY` | Vercel | yes |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER` | Vercel | yes |
| `OUTBOUND_TEST_TO` | Vercel | no, but treat as private |
| `WORKER_TOKEN`, `WORKER_EMAIL`, `WORKER_PASSWORD` | Vercel; token also in GitHub secrets | yes |
| `DATABASE_URL` | local only, never Vercel | yes |

**Commands (planned):** `dev`, `check` (typecheck, lint, tests), `e2e`, `db:migrate`, `db:contract`, `secret`, `gmail:token`, `auth:make-worker`, `auth:make-admin`, `pipeline -- domain` (offline, on fixtures), `smoke -- domain --live` (real Hunter, Gemini and Gmail; spends budget).

---

## 15. Testing

| Layer | What it proves |
|---|---|
| **SSRF table** | About 40 hostile cases: private IPs, decimal and hex forms, IPv6-mapped, redirect to localhost, DNS that changes between lookups |
| **Score function** | Same facts give the same score; adding a positive signal never lowers it; every gate; boundary values at 45 and 65 |
| **Quote verifier** | Verbatim, whitespace-shifted and invented quotes |
| **Contact ranker** | Each size band; generic and junior exclusions; tie-breaks |
| **Lint** | Each of the 12 rules with a passing and a failing draft |
| **Message builder** | Header-injection attempts in subject and name |
| **Hunter client** | Quota arithmetic, cache hits, 400, 401, 429 mapping |
| **Database contract (PGlite, a real Postgres 18)** | The migrations run as written. Who can read and write what, per role; no privilege for the anonymous or service role; append-only on 17 tables; stamping; one live email per prospect; every email status change checked pair by pair; send cap and one-per-domain; claim, lease and retry behaviour. *Not testable in one connection:* two workers truly claiming at the same instant. That rests on `FOR UPDATE SKIP LOCKED` plus the advisory lock, and should be watched on the first live run |
| **Pipeline end to end (PGlite + fakes)** | A domain goes from queued to a sent test email through the real queue and roles, with a fake web, Gemini, Hunter and Gmail; plus every early exit, retry, unknown send, lost lease and the privacy rule |
| **Pipeline on fixtures** | All 7 steps on 10 saved sites with the scripted Gemini; includes an injection page and a JavaScript-only page |
| **Golden set** | Known companies must land in the expected lane. Runs in CI and weekly (catches a prompt or model change moving verdicts) |
| **Browser** | Signed-out surface, security headers, pages at phone width and in both themes, and the dead-control sweep |
| **Live smoke** | One real domain through real services, by hand, before the demo |

---

## 16. Build plan

### 16.1 Before the session (do now; this is what makes 90 minutes possible)

1. Supabase project (Mumbai), sign-up off, your account added.
2. GitHub repo and Vercel project linked; `bom1`.
3. Hunter account and API key; one call to the account endpoint to see the real credit count.
4. Gmail OAuth set up and the refresh token tested (section 8.4).
5. Gemini key entered by hidden prompt (not pasted in chat).
6. **Choose the domain list**: about 12 B2B SaaS companies (aim for a mix: 5 likely fits, 3 likely not, 2 already certified, 2 thin sites). Look up 3 contacts by hand in Apollo for the fallback and for a demo where Hunter has nothing.
7. Save those sites as fixtures for offline tests.
8. Verify the Sprinto facts file against sprinto.com.

### 16.2 The 90 minutes (with the cut line)

**Be honest about size.** The whole scope above is more than 90 minutes of work. The 90-minute target is **Tier 1 of section 13** (the seven steps, the Why page, the lint, the test-mode lock, budgets). Tier 2 follows if the session has time or comes after. The timings below are estimates, tightest in the first 45 minutes, which is why the cut line exists.

| Minutes | Work | Milestone |
|---|---|---|
| 0 to 10 | Scaffold from Freshroots; env; core migrations; deploy a health page | Health shows `{"ok":true,"database":true}` |
| 10 to 30 | Steps 1 to 3 as a command-line run on one domain: scrape, extract, loop, score; fixtures and score tests | `pipeline -- acme.com` prints the score with its quotes |
| 30 to 45 | Steps 4 to 7: Hunter and fallback, pains, draft, lint, Gmail test send | **M1: an email in your inbox with the "why" header.** The case's "done" |
| 45 to 65 | Queue and worker, New run, Run detail, **Why page** | Paste 12 domains, press Run, watch them finish |
| 65 to 80 | ICP page, review queue, suppression, budgets, downloads | A maybe is promoted and sent |
| 80 to 90 | CI green, deploy, live smoke, rehearse the demo | Demo ready |

**Cut line.** If M1 is not reached by minute 45, stop all UI work and finish M1. The Why page is the next thing to protect, because it is the case's second "done". Cut in this order: Ask Outbound, Quality watch, Replay, weekly report, Help polish. Never cut: the lint, the test-mode lock, the budgets, the quote check.

**Running it in parallel with Claude Code.** Three sessions with no shared files: (A) database, auth, queue and worker; (B) the pipeline libraries and their tests; (C) the UI shell and pages. A short merge step at the end.

---

## 17. Demo (3 minutes) and likely questions

| Time | Show | Say |
|---|---|---|
| 0:00 | Runs page, needs attention | "One screen of what needs a person." |
| 0:20 | New run: paste 12 domains; the estimate | "Checked before it starts. It tells you what it will spend." |
| 0:40 | Run detail, steps ticking | "Press Run and walk away." |
| 1:05 | Open a qualified company: Why page | "Every number has a quote. Click it." |
| 1:40 | The inbox: the email with its header | "Addressed to a real person by name, with a hook from their pricing page. The header is the defence." |
| 2:10 | A *not a fit* and a *needs more* | "It says no, and why. It never guesses." |
| 2:30 | ICP page: change a weight, Replay | "Test a different definition of 'fit' without re-scraping." |
| 2:50 | Close | "Gemini reads and writes. Code decides. In test mode no prospect is ever mailed." |

**Likely questions**

- *Why isn't the AI scoring?* A score the model produced would change with the model. Ours cannot.
- *What stops it making things up?* Quotes must exist in the page text; Sprinto claims must be in the facts file; the lint refuses anything else.
- *Could it email a real person by mistake?* No code path takes a contact's address as a recipient.
- *What if Hunter has no one?* Manual contact, or the review lane.
- *What do we do when the quota ends?* It says so, and the Apollo CSV still works.
- *Why 65?* It is a hypothesis. Replay and the golden set are how we tune it.
- *What is not built?* Live sending, reply tracking, follow-ups.

---

## 18. Known limits (said plainly)

- **JavaScript-only websites** give little text because we do not run a browser; they land in "needs more".
- **Headcount and stage are inferred** from the site (stated team size, job counts). They are flagged as estimates; we do not scrape LinkedIn.
- **Hunter's quota is small.** At most a couple of dozen fully live domains a month. Cached results and manual contacts stretch it.
- **The ICP weights are a researched hypothesis**, not tuned on Sprinto's won and lost deals. They should be tuned against real outcomes once there are some.
- **Sprinto's own site blocked our research**, so the facts file depends on you verifying it.
- **Test mode proves the pipeline, not deliverability or replies.** Spam filtering, sender reputation and reply handling are untested until live.
- **Gemini is not perfectly repeatable** across model updates. The golden set exists to notice.
- **A quote on the page is not proof the page is true** (section 7.2). Grounding stops the model inventing evidence; it cannot stop a company overstating itself.
- **Gemini's exact schema behaviour is unconfirmed until we have the key.** Model names were checked against Google's model page on 4 Nov 2026 (`gemini-3.6-flash` stable, `gemini-3.5-flash-lite` stable); that page does not say which models support JSON-schema output or function calling, and whether `nullable` works together with `enum` in the response schema is something the first live call must pin.
- **Gmail refresh tokens can expire** (section 8.4).
- **Scraping has terms-of-service and robots considerations.** We obey robots.txt and fetch only public pages, but you should decide, before going live, that this is acceptable for Sprinto.
- **The what-if and replay measure how the rubric behaves**, not whether the emails would convert.

---

## 19. Sources

- Sprinto positioning, frameworks, plans, and customers: search results including [Elevation Capital's portfolio note](https://elevationcapital.com/portfolio/Sprinto), [Sprinto plans and pricing (docs)](https://docs.sprinto.com/settings/billing/sprinto-plans-and-pricing), [Sprinto for startups (Ignite)](https://sprinto.com/ignite/), [the MoveInSync case study](https://sprinto.com/customers/moveinsync/) and [YourStory's funding report](https://yourstory.com/2022/02/funding-alert-compliance-automation-startup-for-saas-companies-sprinto-series-a-elevation-capital/amp). Sprinto's own homepage returned 403 to our fetch.
- Hunter's API parameters: [Hunter OpenAPI specification](https://hunter.io/openapi.json). Free-plan limits: [Hunter pricing](https://hunter.io/pricing) and third-party guides (which disagree with the case's 25).
- Gmail token lifetime in testing mode: third-party guides ([Nango](https://www.nango.dev/docs/integrations/all/google-mail), [WP Mail SMTP](https://wpmailsmtp.com/docs/error-invalid_grant-token-expired-or-revoked/)). Confirm in Google's OAuth documentation.
- Gemini tools plus JSON-schema reliability: [a developer-forum report](https://discuss.ai.google.dev/t/function-calling-with-a-response-mime-type-application-json-is-unsupported/105093). Not official.
- Vercel function limits and Fluid compute: Vercel documentation (search index).

---

## 20. Questions for you

1. **"The AI link they gave us inside the case study."** The PDF's only link is sprinto.com. Is there another link (a model endpoint, a starter kit, a Sprinto resource) I should see? Until then I assume it means Gemini.
2. **Hunter, Apollo, or both?** I defaulted to Hunter plus manual Apollo fallback (D1). Do you want Apollo-only?
3. **Gmail.** Is `siddhant_bassi@pg27.mesaschool.co` a Google Workspace account (OAuth "Internal", no expiry) or a personal Gmail account (7-day token)? Should the test-mode inbox be that address?
4. **Sender identity** in the emails: your name and a title such as "Growth, Sprinto"? And is it acceptable to use a placeholder postal address for the footer in test mode?
5. **Time.** Is the build confined to the 1.5-hour session (then do section 16.1 now), or do we have longer?
6. **Domain list.** Do you already have the list, or should I propose 12 candidates?
7. **Name.** Is "Sprinto Outbound" fine, or do you want a product name?
