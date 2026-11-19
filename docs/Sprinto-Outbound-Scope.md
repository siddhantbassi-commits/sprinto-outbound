# Sprinto Outbound: Scope

### MESA AI-Native Track · Case 02 · "Cold Outreach, at Scale" · 3 November 2026

Working name: **Sprinto Outbound**. Companion file: [Sprinto-Outbound-Components-Map.pdf](Sprinto-Outbound-Components-Map.pdf) (the one-page map; every number below matches it).

**How to read the tags.** **[Case]** is a fact from the brief. **[Research]** is something I looked up (sources in section 19). **[Assumption]** is my choice, to be confirmed or replaced. Everything else is design.

---

## Status (18 November 2026): built, deployed and rehearsed on real data

This document began as the plan. It has been corrected to match what exists; where the build departs from the plan, the section says so.

**What exists.** A Next.js app on Vercel (Mumbai) at https://sprinto-outbound-eight.vercel.app, invite-only, in test mode. Supabase holds the data and sign-in (16 migrations, row level security, append-only history). A GitHub Actions worker runs every 15 minutes, and a weekly job runs the discovery digest. Gemini, Hunter and Gmail are all live. 1,664 automated tests in 79 files pass and the typecheck is clean. The logic that decides things (score, ranking, lint, edit measure, scorecard, run view) was also checked by deliberately breaking it and confirming a test fails; survivors were either harmless or became new tests.

**Pages:** Today, Discover, Runs, Paste a list, Run detail, Weekly digest, Leads (board, search, saved views, exports), Call brief, Why, Review, Impact, Scorecard, What is working, Quality, Ask, Rulebook, ICP and replay, Settings, Go-live readiness, People (and a Test inbox in demo mode only).

**Guest access.** The real app is also the public link. Someone who is not signed in becomes a guest: after a short welcome animation, the server acts for them through one dedicated admin account (its password is a server setting, never sent to the browser), so a guest can search for companies with Hunter's Discover, start runs that read real sites with Gemini and look up contacts with Hunter, see the contacts and drafts, and change the ICP, the rules and the settings, as an admin can. Three rails keep a public link safe: a guest cannot manage people (they could lock the owner out); spending is capped and counted from the database so it holds across servers (5 companies a run, 25 a day, a daily token allowance, 6 Hunter lookups a day, and 15 of the owner's credits never touched); and mail only ever goes to the owner's own test address, which the server fixes. Guest actions are recorded under the guest account. A separate sample-only deployment (invented companies, scripted model, no keys) remains for local use and as a fallback.

**The first real run.** Two real companies (`documenso.com`, `trigger.dev`) were read, scored and judged in 55 seconds. Both scored "maybe" (58 and 52) because headcount was not on their sites, so company size scored 0 and nothing was guessed. No Hunter credit was spent until a person promoted one. Documenso was promoted for its own compliance page ("SOC 2: Planned (2026)", 25 points). Hunter found a Co-Founder (confidence 85); the system chose two pains, wrote the email (about 14,500 model tokens for the whole company), passed all 12 checks, held it for approval, and after a person approved it as written, sent it to the test inbox. The trace and the Why page show every step.

**What only real use found.** The fakes were good, but these faults needed real data and a real model:
1. **Thinking tokens eat the answer.** The Gemini 3.x models spend output tokens thinking before they answer or call a tool. At 300 or 512 tokens a round could end with no tool call, which the loop reads as "nothing more to fetch", and a real six-page site overran the 4,096-token extraction budget. Budgets were measured against the real models and raised (loop 1,024, extraction 12,288).
2. **Promoting a "maybe" failed.** It sent the company back through the whole qualify step, which then collided with its own saved facts. A promoted "maybe" now carries on without being read again, and a re-run adds a second pass of facts. The test that had written the broken behaviour down as expected was corrected.
3. **The hook was not the strongest signal.** The first draft opened on an Enterprise License line while the strongest evidence (SOC 2 planned for 2026) ranked low. Hook options are now ordered by the company's highest-scoring quotes first.
4. **A pain that contradicted the company's own facts.** The draft for `trigger.dev` told a company that already holds SOC 2 Type II that prospects ask for a report it "cannot yet hand over". Pain P1 was triggered by an enterprise tier alone. A pain can now name signals that contradict it (here, a held SOC 2 Type 2 report) and is then not offered at all. The 12 checks cannot catch this kind of fault; it was found by reading a real draft, which is what the approval step is for.
5. **A draft cut off by its own thinking.** A draft is about 120 tokens of email but 2,300 to 3,400 with the model's thinking, so a 2,048-token ceiling cut it off almost every time (the first real draft only got through by luck). The draft ceiling is now 6,144 tokens and its timeout 40 seconds.
6. **A smoke test that passed for the wrong reason, and a grant that was too wide.** With a wrong Supabase key the anonymous check passed vacuously (a check that the key is accepted was added), and a catalog check of the live database found a helper function callable by the public (closed by a migration).

**Discovery, added on 18 November.** The first version started from a pasted list, which makes the person do the hardest part. The product now starts from *who Sprinto should talk to*. The signed-off ICP is turned into explicit Hunter Discover filters (size bands the ICP scores well, regions, "Software Development"), and three searches run: companies hiring for security, compliance or privacy roles in the last 90 days; B2B software; and regulated or data-heavy sectors. They are merged and ranked by how many agree, with a bonus for the hiring signal. Two things were learned by trying it. A loose plain-English query reads "enterprise" as "huge" and returns Infosys, and "hiring a security role" finds hotels, universities and charities, so every angle is narrowed to software companies and each candidate's home page is opened before it is shown (one polite fetch, robots.txt obeyed, no model). Software sold *to* hospitals and schools had to be told apart from a hospital with a login page. Hunter Discover costs no credit, so searching is free; a match is only a lead, and fit is decided after the company's own site is read and scored, exactly as for a pasted list. Competitors and the do-not-contact list never appear; companies already researched, suppressed or recently mailed are shown last with the reason. A real search of 256 Hunter matches took 17 seconds and returned real software companies with their own descriptions.

**The discovery-call brief.** Every researched company has a page for the call: the fit with the quote behind each reason, who to speak to and how sure the address is, why now, two talking points each tied to the company's own words, questions to ask (from a fixed library keyed to the nine pains), likely objections (only those the evidence makes likely), and the only claims about Sprinto a person has verified. It is built by code from what the pipeline already recorded, with no extra model call, so it cannot say more than the evidence does; what is not known is listed as not known. A **Leads** page lists every researched company best fit first.

**A formal email.** The greeting is now "Dear Priya,", the sign-off "Kind regards,", the subject line professional, and the drafting prompt asks for a formal register (`draft-v4`). The first real formal draft (Cleverbridge) passed every check but read clumsily, because the pains were splices of fixed phrases ("waiting months to hire someone to own compliance can create friction when larger prospects asking for a SOC 2 report cannot be served promptly"). The prompt now treats each pain as a theme to put in the model's own words, one sentence per pain, with a short made-up example of the shape; three drafts on the real model afterwards were grammatical, factual and passed on the first attempt. The message goes out as multipart: plain text first, and an HTML letter built from the approved text, with every character escaped and nothing loaded from elsewhere. The review desk shows that same letter. In test mode a small notice sits *under* the email (it used to sit above it, which looked like a test rather than the real thing) saying it went to the owner only and who it would have gone to.

**The weekly digest.** A search that is only run when someone remembers to open the app finds nothing while nobody is looking. Criteria set on Discover can be saved as the weekly search; every Monday at 9:00 India time a scheduled job (the same shared-secret pattern as the worker and the golden set) runs it, keeps only companies that are new (not researched, suppressed, mailed in the cooldown, or shown in any earlier digest), emails the owner a short formal note (HTML and plain text) and records what it found and whether the email went out. It costs nothing: Discover uses no Hunter credit and the digest calls no model. It is safe to call twice: a digest that ran in the last six days is not repeated unless a person presses "Run it now". The email goes only to the owner's own address, and only when it matches the test address in Settings; otherwise the digest is still recorded, with "email not sent" and the reason. Both tables are append-only. The honest limit is that Hunter returns broadly the same top matches until its data changes, so a quiet week says "Nothing new" instead of padding the list; the hiring angle is the one that changes week to week.

**A daily workspace, a board, and a readiness check (18 November).** Four things were added because the product had features but no place to use them from.
- **Today** is now the home page: drafts waiting for approval, follow-ups due, new companies from the weekly digest, and what is running, then the pursuit as a strip (To contact, Reached out, Replied, Meeting booked, and the ways it can end). The runs list moved to its own page.
- **Leads** gained a **board** (cards can be dragged between stages, or moved with a select so it works from a keyboard and a phone; moving records the same outcome the form does, and a card cannot be moved back to "To contact" because that is not an event), **search, filters and sort** that live in the address so a view can be bookmarked, **saved views** (remembered in the browser only), a "uses a competitor" mark taken from the rubric's own penalty, and **CSV and HubSpot exports** (HubSpot's own column names and Lead Status values; every cell is guarded against spreadsheet formulas, and a viewer's file holds only masked addresses).
- **The brief** prints as a one-page call sheet, lists up to three **other people worth speaking to** with the pain their role feels most among those the site gives evidence for (preferring a different angle from the first email), and can **pay one Hunter credit to check an address** that Hunter could only call "accept all". The check refuses to dig into the reserve, stores only the status and score (never the address, so the 90-day rule has nothing to remove) and records the credit in the ledger. The other people are for the call: the product still emails one person per company within the 30-day cooldown, and that rule is not relaxed.
- **Go-live readiness** reads the sending domain's SPF, DKIM (Google's selector) and DMARC and its mail servers live from DNS, checks the sender's details (a full postal address, a real name and title, verified claims, a signed-off ICP, approval on, the worker alive) and recommends a daily ramp (10 a day for the first week, 25, 50, 100, then 200). It also lists the safeguards that are built in. It is explicitly not a switch: the sender cannot take a recipient, so sending to real prospects is a reviewed code change. Every message now carries a `List-Unsubscribe` header. Running it against the real configuration found that the sending address is a personal Gmail account, which cannot carry its own SPF, DKIM and DMARC, so that check fails until mail is sent from a domain the company controls.
- **What is working** compares outcomes against the rubric once at least ten companies have been reached: whether a score at or above the bar did better, and which signals went with replies or meetings, showing the sample behind every figure and suggesting a weight to try only where each side has five or more. It never changes a weight by itself.
- Smaller changes: Discover lists who it dropped and why; a bell in the app bar keeps a history of finished runs; the tour gained a Today stop.

**A size from Hunter, labelled as Hunter's.** The first three companies researched from the digest (Paddle, Delasport, Aiven) scored 58, 48 and 46: two were "needs more" because their sites do not state a headcount, although Discover had found them by asking for a size band. Hunter's Discover response carries no per-company size, only that a company matched the filter, so the search is now run once per chosen size band and each company is tagged with the band it came from (a company two bands both return is left untagged). A run started from Discover or the digest carries that band into the run as a hint. The rule that keeps it honest: a size the site states always wins; the hint only fills in a size that is otherwise unknown, marked as Hunter's, at medium confidence (so the score flags it as an estimate), with no quote because there is none. The score part is labelled "Company size (51-200 per Hunter, not stated on the site)", the Why page says so, and the trace records whether the hint was used. A hint can only be added before a company has been read, so it cannot be used to change a verdict afterwards. Searching now makes one Hunter request per band per angle (nine for three bands and three angles); Discover is free, but it is slower.

**Outcomes.** Until now the system stopped at "email sent to the test inbox", so nothing could say whether the ICP or the emails were any good. A person can now record what came of each lead (reached out, replied, meeting booked, not interested, bounced, wrong person) with a note and an optional follow-up date, from the Leads page or the lead's brief. Each is an append-only row stamped with who recorded it; the newest row is where the lead stands and the older rows are how it got there. The Leads page gains a Follow up tab (overdue first) and drops a clear no from "Worth a call"; Impact gains an After-the-outreach section that reports replies and meetings as shares of the companies *reached*, and says "nothing recorded yet" rather than a rate when there is nothing. "Not interested" can also put the company on the do-not-contact list in the same step, and a reply or bounce is written once as the decision Impact already counts, so recording it twice does not count it twice. These are hand-recorded, so they are only as complete as people keep them, and in test mode they describe calls and messages made by hand, since the system's own emails go only to the owner.

**Progress and notifications.** The run page shows a bar weighted by the work each step takes, with what is happening now and about how long is left. The time is the sum of the steps still to do, using typical step times that are refined from the system's own recent steps (median, so one slow call does not skew it). A small card follows the person across the app while a run works, keeps the worker moving from the browser, and announces when the run is ready (a toast, a browser notification if allowed, the tab title); a run that finished while the person was away is announced the next time they open the app. The notice says only what is true: research continues while the window stays open, and the scheduled worker picks it up, more slowly, if it is closed. A first-visit tour of nine short stops can be taken again from the question mark.

**Added beyond the plan.** A **human approval gate**: every draft waits on the Review desk, where a person approves, edits (measured in words, and re-checked against the same 12 rules) or rejects with a reason; each decision is a permanent row. A **Scorecard** that checks the class's own kill criteria against those decisions (stop if over 50% of emails are rewritten, if the right person is chosen under 60% of the time, or if the system costs more time than it saves), and says "too early to say" below 8 decisions. **Impact** (the funnel and time saved with its working), a **Rulebook** page (the evidence map and rules in words), a live run view, a paste box that finds domains in any text, a readiness checklist, and a design in Sprinto's own colours.

**Different from the plan**
- Contacts: Hunter plus a **hand-picked contact form** in Settings, not a CSV import of Apollo results.
- No Help page, no weekly-report page (the report text is on Impact) and no "eight CSV downloads" (one export: a run's results).
- Replies and bounces are not tracked, so conversion cannot be measured in test mode and the Scorecard says so.
- Gmail is a personal account with the OAuth app in **Testing**; Google would not let it be published without a domain we own, so the sign-in lasts about 7 days and is renewed with `npm run gmail-token`.
- The browser sweep and Playwright tests in the original plan were not built; pages were checked by hand in a browser pane, on desktop and phone width.

**Still open.** The postal address in Settings was a bare postcode and needs a full address before real use. One verified claim about Sprinto exists (F1, checked against the case brief). The second "maybe" (trigger.dev) is waiting for a person's decision. An automated browser sweep that clicks every control is not written, and the draft prompt changed (a verified claim's figures may now be quoted), so the golden set should be re-run on the real model.

---

## 0. Read this first

**What we are building.** A pipeline you run on a list of domains. For each domain it reads the company's public website, works out whether the company fits Sprinto, finds one named decision-maker, picks the two pains that person most likely has, writes a short personal email with a hook taken from the site, and sends it through Gmail. Around the pipeline sits a small platform: sign-in, a run page, a "why" page for every company, a Review desk where a person approves each draft, a versioned ICP, budgets, a suppression list, quality checks, a Scorecard and a run download.

**The one idea the whole design rests on.** The case's second "done" line is *you can defend every decision the system made: why this company, why this person, why this email*. So the design is built backwards from that sentence:

- **Gemini reads and writes. Code decides.** Gemini turns messy page text into structured facts and writes the draft. A plain TypeScript function turns those facts into a score. Same facts, same score, every time.
- **Every fact carries a quote** copied from the page. Code checks the quote really appears in the stored page text. A fact whose quote cannot be found is thrown away.
- **Every step writes a trace** (inputs, output, prompt version, model, tokens, time). The "why" page is just that trace made readable.

**The safety line (the human boundary).** In test mode, which is the only mode we build, every email goes to *your own inbox*, as the case instructs [Case]. The real contact is recorded and shown at the top of the email ("Would have gone to Priya Rao, CTO"), never mailed. There is no live-send button, because a dead or dangerous button is exactly what we have avoided in every past build. Nothing is sent until a person has approved it on the Review desk (decision D8).

**What this reuses.** A large part of the platform already exists in Freshroots Ops: sign-in and roles, the app shell and light/dark theme, the Gemini client and loop, rate limiter, security headers and CSP, CSV neutralisation, migration runner, database contract tests, CI and the scheduled GitHub Action. We copy and adapt them (section 14). That is what makes this achievable in the time.

**Decisions I made so we could move. Change any of them.**

| # | Decision | Why |
|---|---|---|
| D1 | Hunter is the primary contact finder; a hand-picked contact (looked up in Apollo or anywhere, entered in Settings) is always available and outranks Hunter | The case wants "run it on a list of domains, end to end". Only Hunter has an API. The fallback means a Hunter quota or outage never stops a run |
| D2 | Gmail API with a send-only OAuth scope, not SMTP | Least privilege, no password stored. Needs a one-time token (section 8.4) |
| D3 | Platform, not a script: invite-only sign-in, Supabase, GitHub Actions worker | Matches Freshroots and Clearway quality; the ask says "platform" |
| D4 | Test mode only. `to` is fixed to your address in code | The case says hardcode it [Case]. Also safe |
| D5 | Qualify at 65 of 100; 45 to 64 is "maybe" and waits for a person; under 45 is "not a fit" | The case wants no decisions mid-run, so only clear fits proceed. A person can promote a "maybe" with one click |
| D6 | One Hunter search per domain, cached 30 days, with a hard reserve | Quota is tiny (section 8.3) |
| D7 | Gemini does extraction, page-choosing, pain-picking and drafting. It never scores, never picks a recipient, never sends | Defensibility |
| D8 | A person approves every email before it is sent (on by default; an admin can switch it off, with a reason, and the page then says so) | The class's own plan has the Growth Lead reviewing before any send, and the rewrite rate is the number that says whether the system saves time |
| D9 | The class's kill criteria are checked from recorded decisions, and a small sample is shown as "too early", never as good news | Deciding in advance when to shut it down, then actually checking |

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

*Built differently from the first sketch:* extraction and qualification are one step, because the agent loop re-extracts each time it fetches a page, so a separate "extracted" state would never be resting. A 'maybe' (45 to 64) is parked in **review** for a person to promote; "needs more" and "no contact" are lanes, not errors. *Found by the first real run:* promoting a 'maybe' must carry on to the contact step without reading the company again (the person has already judged it), and a deliberate re-run saves a second pass of facts.

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

Gemini gets: the contact's first name and title, the company card, the two pains and their evidence, the facts file, and the lint rules in plain words. It returns `subject`, `body`, `hook_evidence_id`. The hook options it may choose from are verified quotes from the company's own pages, listed with the company's highest-scoring signals first, then the evidence for the two pains. Code lints (6.4). Up to 2 repairs, then hold, and a person approves the result before it is sent.

### 7.7 Step 7: Send

- Build the message with strict header handling; encode the subject; plain text.
- `sendTest(draft)` **takes no recipient**. The `To` address comes only from the server setting `OUTBOUND_TEST_TO`. There is no code path where a contact's address becomes a recipient.
- Gmail API `users.messages.send` using a refresh token with the send-only scope.
- **The text that is sent is the person-approved text** (as written or as edited) when approval is required, which is the default. A rejected draft is never sent, even if something puts the company back in the queue.
- **No double sends.** Before calling Gmail the system inserts a `sending` row guarded by a unique index. If Gmail confirms, the message ID is saved. If the call times out in a way that could have sent, the row becomes **unknown** and is *not* retried: it goes to Needs attention with the header to search for in Sent (`X-Outbound-Run`). A clear failure (bad token, 4xx) is retried up to 3 times with backoff, then held.
- Caps: 20 sends a day and one per domain per 30 days by default (settings). The cap is enforced by a database function, so a bug cannot exceed it.

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
              scrape ─► extract(Gemini) ─► agent loop(Gemini) ─► score(code) ─► Hunter ─► pains ─► draft(Gemini) ─► lint ─► REVIEW (a person) ─► Gmail
                                                              │
                                  every step appended to the trace (Supabase, append-only)
                                                              ▼
                       Why page · Review desk · Run view · Impact · Scorecard · Quality · Ask Outbound · run CSV
```

### 8.2 What each service is for

| Service | Role | Notes |
|---|---|---|
| **GitHub** | Source, CI, scheduled worker | CI runs typecheck, lint, tests, build, browser smoke tests. A cron workflow calls the worker every 15 minutes and loops until the queue is empty or about four minutes pass [Freshroots experience: GitHub's scheduled runs can start late or not at all, so the Runs page warns if there has been no tick for an hour, and opening a live run also ticks] |
| **Vercel** | The Next.js app and the worker endpoints | Region `bom1`. The worker endpoints take a few steps per call within a 20-second budget and are allowed 60 seconds; a single extraction call on a real site can take about 25 seconds, so a call can legitimately run long, and the schedule or the live page simply calls again. All third-party secrets live only here |
| **Supabase** | Postgres, Auth, row level security | Invite-only. No service-role key in the app; the worker signs in as its own account (the pattern Freshroots uses for its scheduler) |
| **Gemini** | Extraction, page-choosing, pain-choosing, drafting, Ask Outbound | Key held only on the server. A model fallback chain of its own, pinnable with `GEMINI_MODEL`; names checked against Google's model page, behaviour confirmed with the key |
| **Hunter** | Contact search | One call per domain, cached, budget read from Hunter's own account endpoint |
| **Gmail** | Sending | Send-only scope |

### 8.3 Budgets (they decide what the system may do)

- **Hunter.** [Hunter's published OpenAPI spec, checked 4 Nov 2026] `GET /v2/account` returns `data.requests.credits.{used, available, remaining}` when the team has a single credit pool (otherwise `searches`), a domain search costs 1 credit and only when it returns at least one result, and every search response carries an `X-Credits-Used` header. The API key can go in an `X-API-KEY` header, so it is never in a URL. The case says 25 searches a month [Case]. Hunter's pricing page lists 50 credits a month for free accounts [Research], and the real account confirmed 50 credits (resetting monthly). We therefore **ask Hunter how many credits remain** (its account endpoint, cached for 10 minutes) and keep a reserve of 3. A run is refused or trimmed with a message when it would breach the budget, and the New run page shows the estimate before you press Run.
- **Gemini.** 60,000 tokens per domain, 400,000 per run (editable). A domain over budget stops as "needs more" with the reason. A real company used about 14,500 tokens from read to drafted.
- **Gmail.** 20 a day.

### 8.4 Gmail set-up, and the trap

Done once, with a personal Gmail account: a Google Cloud project, the Gmail API enabled, an External consent screen with only the `gmail.send` scope, a **Desktop app** OAuth client, and the one-off `npm run gmail-token` helper to get the refresh token. The helper signs in through a loopback address on the machine, uses PKCE, ignores any callback that does not carry its own state, refuses a token that carries more than permission to send, and writes the token to `.env.local` without printing it. The values are then copied to Vercel as hidden secrets.

- **The trap, confirmed in practice.** The consent screen is External and in *Testing*, so the refresh token **expires after 7 days** [Research, then observed]. The "Publish app" button stayed disabled without a domain we own to list as authorised, so the app stays in Testing, the sending account must be added as a test user, and the token is renewed with `npm run gmail-token` before any demo. A Google Workspace account with an *Internal* app would avoid this.
- **Scope.** Google also offers `gmail.send.self` ("send to yourself"). It would be the narrowest, but the test address here is a different inbox from the sending account, so the full send scope is used.
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
- Added since: **`email_reviews`** (one append-only decision per draft: approve or reject, the final subject and body, the share of words changed, whether the contact was the right one, a reason) written only by the `approve_email` and `reject_email` functions; `settings_versions.require_approval`; **`golden_runs`** (the quality check's history); **`role_changes`** (who changed whose role); and a migration that closed a function the public could call, found by checking the live database.
- `facts` pass numbers continue where they left off, so a re-run adds pass 2 rather than overwriting pass 1.
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
- Tests use a **scripted fake Gemini client**, as in Freshroots, so the suite is offline and repeatable. The real models were then measured separately (`npm run smoke`, including a real dry run on one company), which is how the thinking-token budgets were found.
- Each call has room for the answer **and** the model's thinking: loop rounds 1,024 tokens, Ask and pains 4,096, draft 6,144, extraction 12,288.

---

## 11. The product: pages

One shell, one design system (the Freshroots tokens: dark by default with a light theme, a single accent, colour kept for meaning, phone-width layouts, visible keyboard focus, reduced motion respected). New accent colour so it reads as its own product. Colour meaning: green = qualified or sent, amber = needs a person, red = failed or blocked, blue = information.

**The "no dummy buttons" rule.** Every control either works or is not shown. Things that are off are shown as *status* (a "Test mode" chip with a sentence), not as disabled buttons. This is enforced by a test (`tests/controls.test.ts`) that fails on a control that plainly does nothing, and each page was also checked in a browser. A second test (`tests/links.test.ts`) reads every link in the source and fails on one that points to a page that does not exist, to a field that does not exist, or to the page it is already on, and a checklist button that has nowhere useful to go becomes a plain note. The test cannot know that a handler is *useful*, only that it is not empty.

Every page has a loading skeleton, an empty state that says what to do, and an error state that says what happened. The design uses Sprinto's own palette (plum, warm paper, a lime accent), dark and light themes, a command palette (press Cmd-K to jump to any page or company), and motion that explains something (progress, arrival, success) and switches off for people who ask for reduced motion.

| Page | What it is for |
|---|---|
| **Today** (home) | What needs her now: drafts to approve, follow-ups due, new companies from the digest, what is running, and a readiness checklist until everything required is in place (including a full postal address, since it ends every email) |
| **Runs** | The list of runs, the last 7 days against the 7 before, and where every company has ended up |
| **Weekly digest** | The saved search that runs every Monday (or on demand), keeps only companies that are new, emails the owner a short note and records it. Free: no Hunter credit, no model, no company contacted |
| **What is working** | Recorded outcomes compared with the ICP score and the signals behind it, shown only once ten companies have been reached, never as a guess |
| **Go-live readiness** | A plain list of what is still needed before real sending: the sending domain's SPF, DKIM and DMARC records, the sender, the postal address, the unsubscribe header, and a gradual ramp-up |
| **Discover** | Describe a good customer (pre-filled from the ICP), see ranked companies with the reason for each, choose which to research, and see the cost before starting |
| **Leads** | Every researched company as a list or a board you can drag across stages, with search, filters, sort and saved views; who to speak to, the two pains, what came of each lead (reached out, replied, meeting booked, not interested, bounced, wrong person, with a note and a follow-up date) and exports to CSV and HubSpot |
| **Call brief** | Everything for the discovery call on one page, copyable as text or printed as a call sheet; the other people worth speaking to with a different angle for each; a paid check (one Hunter credit) that an address is deliverable |
| **Paste a list** | A paste box that finds domains in any text (a spreadsheet column, an email thread, links) as you type, with a one-click tidy and a CSV drop zone. *Check the list* shows what will run, what is skipped and why, and the Hunter credits it could use, before anything starts |
| **Run detail** | A progress ring and one-line status, a time estimate that waits for enough data, how many companies reached each of the seven steps, a dot track per company, filters, a feed of what just happened, and Pause with a reason |
| **Why (a company)** | The defence page. A plain-English summary written by code from the recorded facts; then the score with each point's quote and source page, the ranked contact candidates, the two pains, the draft with its 12 checks, the person's decision on it, and the full append-only trace. Actions: promote, put back in the queue, re-run, do not contact, add a contact by hand |
| **Review** | The desk where a person decides. Drafts waiting for approval, with the email, why the company scored, the contact and any flags beside it; approve, edit (measured, and re-checked) or reject with a reason; clean drafts can be approved together; keyboard shortcuts. Below it, the companies that need a person for other reasons (maybes, no contact) |
| **Impact** | The funnel, where the rest went and why, quality rates, cost as quantities, and time saved *with its working*; a weekly report you can copy or print |
| **Scorecard** | The class's three kill criteria checked against recorded decisions, each on a gauge with its stop line, the time comparison, and "too early to say" below 8 decisions |
| **Quality** | This week against last week, with "not enough data" wherever a sample is too small, and the golden set of known companies (run on demand and weekly) |
| **Ask** | Plain-English questions answered from the records through seven read-only lookups, with what it looked at shown. It changes nothing |
| **Rulebook** | The seven steps and who does each, the evidence map (what question, which page, when it is enough), the rubric in words, the defences, the human boundary and the shutdown rules |
| **ICP and replay** | The rubric and every version with what changed; sign-off; **Replay**: re-score every stored company under a draft ICP without re-reading any site, and see who moves lane (nothing saved) |
| **Settings** | What must be true before sending (with a readiness ring), the approval switch, the sender, limits and cost assumptions, the claims an email may make about Sprinto (each verified by a person against its source), the do-not-contact list, and hand-picked contacts. Every change is a new version with a reason |
| **People** | Admins approve accounts and set roles |

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
| **An email nobody read** | Every draft waits for a person by default; the text sent is the approved text; a rejected draft is never sent; switching approval off needs an admin and a reason, and the app then shows a warning |
| **A system that quietly stops being worth it** | The Scorecard checks the shutdown rules from real decisions and never reports a small sample as good news |
| **A model that spends its budget thinking** | Output budgets leave room for thinking; a cut-off answer is a retry or a stated failure, never a half answer used as if complete |

---

## 13. Beyond the case

**Tier 1: part of "done"** (all built)
1. The Why page with grounded quotes
2. Deterministic, versioned ICP with a score breakdown
3. Hunter budget, cache and hand-picked fallback
4. Test-mode lock and the "would have gone to" inbox header
5. The 12-check lint and the hold lane
6. Suppression list, opt-out line, 30-day repeat guard
7. Run funnel and drop-off reasons
8. Needs attention list

**Tier 2** (built, except where marked)
9. **Replay** of a different ICP on stored facts (what-if, nothing saved)
10. **Quality watch** with a golden set of known companies, run on demand and weekly
11. **Review desk** with approve, edit and reject, and one-click promote of a maybe
12. **Ask Outbound**
13. **Impact and the weekly report** with time saved and its working
14. Injection flag on pages
15. Subject-line variants stored for later testing (**not built**)

**Added after the plan**
16. **The approval gate and edit measure** (how much a person changed each draft)
17. **The Scorecard** (the class's kill criteria, from real decisions)
18. **The Rulebook** and evidence map, a readiness checklist, a live run view, a paste box that finds domains in any text, and the command palette

**Tier 3: roadmap, said out loud in the demo, not built**
- Going live: a checklist and signed-off setting, a warm-up plan, a domain reputation check
- Reply detection (needs a read scope, so a separate decision) that auto-suppresses, and so measures conversion
- Follow-ups on day 3 and 7, drafted and approved by a person
- Finding new domains from lookalikes of Sprinto's customers
- CRM push and Slack alerts

---

## 14. Repo, environment and reuse

```
sprinto-outbound/
  src/app/(app)/{page(today),discover,runs,runs/new,runs/[id],leads,digest,prospects/[id],prospects/[id]/brief,review,impact,scorecard,learning,quality,ask,rulebook,icp,settings,golive,people,outbox}
  src/app/enter/               the welcome animation (demo and guest pass)
  src/app/api/{worker/tick,worker/golden,worker/digest,runs/advance,demo/warm}
  src/lib/{scrape,extract,icp,discovery,digest,brief,golive,contacts,pitch,email,ai,agent,worker,ask,quality,app,db,demo,smoke}
  supabase/migrations/        16 files, append-only history, each applied once
  scripts/{keys,smoke,golden,gmail-token}.ts
  tests/                      79 test files; tests/db runs the real migrations on PGlite (a real Postgres)
  .github/workflows/{ci,worker,golden,digest}.yml
  docs/{Sprinto-Outbound-Components-Map.pdf,Sprinto-Outbound-Scope.md,DEMO.md,REHEARSAL.md,map/}
```

**Reused from Freshroots Ops, adapted:** sign-in and roles and `proxy.ts`; the theme approach; the Gemini client and loop pattern, rate limit and in-flight gate; `next.config.ts` headers and CSP; CSV neutralisation; the PGlite contract-test harness; the CI and scheduled-workflow patterns. **Reused from Clearway:** the hidden-prompt key script, and the "AI reads, rules decide" structure. Everything else was written fresh for this case.

**Read first:** `AGENTS.md` warns that this Next.js version has breaking changes. Before writing code, read the docs shipped in `node_modules/next/dist/docs/`.

**Environment** (local `.env.local`, copied to Vercel; secrets are entered through a hidden prompt, never pasted into a chat)

| Name | Where | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, local | public by design |
| `GEMINI_API_KEY` (and optional `GEMINI_MODEL`) | Vercel, local | yes |
| `HUNTER_API_KEY` | Vercel, local | yes |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_FROM` (and `GMAIL_FROM_NAME`) | Vercel, local | yes |
| `OUTBOUND_TEST_TO` | Vercel, local | no, but treat as private |
| `CRON_SECRET` | Vercel, local, and a GitHub secret | yes |
| `WORKER_EMAIL`, `WORKER_PASSWORD` | Vercel, local | yes |
| `APP_URL` | Vercel, and a GitHub secret | no |

There is no Supabase service-role key anywhere: the worker signs in as its own limited account.

**Commands:** `dev`, `dev:demo` (sample data, no keys), `check` (typecheck and tests), `keys` (hidden-prompt key entry, `-- --only gmail` for one group), `smoke` (checks every service; `-- --send` sends one test email; `-- --pipeline domain` is a real dry run on one company), `golden` (the quality check), `gmail-token`.

**Deployment:** `npx vercel deploy --prod` (a `.vercelignore` keeps uploads to source only), with the same settings as above held in Vercel.

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
| **Pipeline on the demo world** | All 7 steps on invented companies with a scripted model, including an injection page, a JavaScript-only page, a competitor and a company that needs approval |
| **Golden set** | Known companies must land in the expected lane. Runs in CI and weekly (catches a prompt or model change moving verdicts) |
| **Browser** | *Not automated.* Pages were checked by hand in a browser pane at desktop and phone width, and the live app's headers were checked with `curl`. A static dead-control test exists (below); an automated browser sweep that clicks every control is still to be written |
| **Live smoke** | `npm run smoke` checks every service; `-- --pipeline domain` runs one real company through the real site and the real model, with nothing sent. This is what found the thinking-token budgets |
| **Approvals, scorecard and run view** | The approval gate (approve, edit, reject, switched off, rate-limited retry), the edit measure, the kill-criteria rules at every boundary, and the run page's progress, estimate and filters, each with deliberate-break checks |
| **Every control does something** | `tests/controls.test.ts` reads the syntax tree of every component and page and fails on a button with no type or handler, a link to nowhere, a form with no action, an empty handler, or a permanently disabled button; each rule was proven by planting a dead control in a real page |
| **Totals** | 1,664 tests in 79 files, offline and repeatable |

---

## 16. Build plan

*Kept as written, for the record.* The session plan below was the intent for the case's 90 minutes. The system as built goes well beyond Tier 1; the timings are not a record of how long it took, and the "Before the session" list was done live with the Growth Lead (accounts, keys, Gmail, Vercel), in an order shaped by what failed along the way.

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

The current script is `docs/DEMO.md`, and the practice run behind it is `docs/REHEARSAL.md`. The table below is the original sketch.

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
- *What do we do when the quota ends?* It says so, and hand-picked contacts still work.
- *Why 65?* It is a hypothesis. Replay and the golden set are how we tune it.
- *What is not built?* Live sending, and automatic reply tracking: replies and meetings are recorded by hand on each lead, so conversion is only as complete as what a person records.

---

## 18. Known limits (said plainly)

- **JavaScript-only websites** give little text because we do not run a browser; they land in "needs more".
- **Headcount and stage are inferred** from the site (stated team size, job counts). They are flagged as estimates; we do not scrape LinkedIn.
- **Hunter's quota is small.** The free allowance is 50 credits a month, and only companies that qualify or are promoted spend one. Cached results and hand-picked contacts stretch it.
- **The ICP weights are a researched hypothesis**, not tuned on Sprinto's won and lost deals. They should be tuned against real outcomes once there are some.
- **Sprinto's own site blocked our research**, so the facts file depends on a person verifying it. One claim (F1) is verified, against the case brief. A figure inside a verified claim may be quoted in an email; a figure in an unverified claim never can, because the model is never shown an unverified claim.
- **Test mode proves the pipeline, not deliverability or replies.** Spam filtering, sender reputation and reply handling are untested until live.
- **Gemini is not perfectly repeatable** across model updates. The golden set exists to notice.
- **A quote on the page is not proof the page is true** (section 7.2). Grounding stops the model inventing evidence; it cannot stop a company overstating itself.
- **Gemini's behaviour is now measured, but it can change.** With the real key, JSON-schema output and function calling both work on the three models in the chain, and `nullable` together with `enum` is accepted. The models spend output tokens thinking, which is why each call's budget leaves room for it. A model update could change this; `npm run smoke` and the golden set exist to notice.
- **The Gmail sign-in expires about every 7 days** while the Google app is in Testing mode, and cannot be published without a domain we own (section 8.4). Renew it before any demo.
- **Conversion is measured only from what a person records.** Nobody outside is mailed in test mode, and replies are not read from an inbox: a person records each outcome on the lead. Until real outreach happens the counts are zero, and the Scorecard and What is working say so instead of guessing.
- **The guest pass is open to anyone with the link.** It is meant for a reviewer, and spending is capped, but a stranger who finds the link can read the research and use the day's guest allowance. The owner can switch it off by removing `GUEST_PASS` and redeploying.
- **The sender is a personal Gmail address** and the postal address in Settings is incomplete, so the Go-live page lists both as open. Real sending needs a sending domain with its own SPF, DKIM and DMARC records and a full postal address.
- **Many companies score as a "maybe".** Headcount is often not on a site and the system does not guess it, so company size scores 0 and a person decides.
- **Time saved is an estimate** from assumptions in Settings (manual minutes, review minutes), not a stopwatch, and is labelled as such everywhere it appears.
- **The hook is a model's pick** among real quotes from the company's own pages. The strongest scoring signals are now offered first, but the model may still choose another; a person sees it before anything goes out.
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

## 20. The questions, and where they stand

| # | Question | Where it stands |
|---|---|---|
| 1 | "The AI link inside the case study" | Not answered. The PDF's only link is sprinto.com, so the AI layer is Gemini, with the key from the course |
| 2 | Hunter, Apollo, or both? | Hunter, plus a hand-picked contact form (D1). Apollo is used only as a place to look someone up by hand |
| 3 | Gmail: Workspace (no expiry) or personal (7-day token)? | A personal account with the app in Testing, so the 7-day limit applies (section 8.4) |
| 4 | Sender identity, and a placeholder postal address in test mode? | Set in Settings. The postal address was a bare postcode and needs a full address before real use |
| 5 | Time: only the 1.5-hour session? | Built over a longer period than the session; section 16 is kept as the original plan |
| 6 | The domain list | Entered by the Growth Lead in each run. The first real run used `documenso.com` and `trigger.dev` |
| 7 | Name | "Sprinto Outbound" kept |
