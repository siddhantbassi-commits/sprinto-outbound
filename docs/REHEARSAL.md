# Rehearsal checklist

A practice run on the live deployment, start to finish, about 25 minutes. It proves the whole chain before anyone watches it, and it
drills the things most likely to go wrong. Everything here is in **test mode**: mail goes only to the test address in Settings, and no
contact is ever mailed.

Live app: **https://sprinto-outbound-eight.vercel.app** (invite-only). The same link needs no sign-in for a guest (a short welcome, then admin-like access with spending caps); the owner signs in at `/login`. `docs/DEMO.md` is the three-minute script; this is the
rehearsal behind it.

Run the rehearsal the day before, and again an hour before, because the Gmail sign-in expires (see "Before anything else").

---

## 0. Before anything else (5 minutes)

- [ ] **Gmail sign-in is fresh.** While the Google app is in *Testing* mode, the refresh token lasts about 7 days. If it is older, or
      you are unsure, renew it. It takes a minute:
      `npm run gmail-token` (sign in with the sending Gmail, click *Advanced*, continue, approve **send only**).
      Then push the new value to Vercel and redeploy (see "Renewing a key on the live app").
- [ ] **Smoke test is green.** `npm run smoke` should show no ✕. Expected `!` lines: the sender and test address differ (fine), and the
      Gmail token note about 7 days. Add `-- --send` once to send one real test email and confirm it arrives.
- [ ] **Supabase is awake.** Free projects pause after a week of no use. Open the dashboard; if it says *Paused*, restore it and wait.
- [ ] **Hunter credits.** `npm run smoke -- --only hunter` prints the balance. Each *qualified or promoted* company costs 1. Decide your
      ceiling for today (the rehearsal below needs at most 3).
- [ ] **Sign in on the live app,** in one browser. Request the link and open it in **the same browser** (the link is tied to the browser
      that asked for it). If a link fails, request a new one; they work once.
- [ ] **Home page says *Ready to send*.** If not, the checklist on the Runs page names what is missing (ICP signed off, Sprinto claim
      verified, test address, Gemini, Gmail, worker heartbeat).
- [ ] **Settings → Sending and limits is right:** a full **postal address** (it prints in every opt-out footer), the sender name and
      title, the test address, *A person approves each email* switched **on**.

## 1. The run (about 5 minutes)

Use a small list so Hunter credits stay low. Suggested: three real small B2B software companies, one competitor, one bad entry.

```
cal.com
posthog.com
resend.com
vanta.com
10.0.0.1
```

- [ ] **Discover first.** Open *Discover*, press *Find companies*. Expect real software companies, each with how it describes itself and why it was suggested, in about half a minute, and no Hunter credit spent. Choose one or two and read their briefs after they finish. Then, for the rehearsal below, use *Paste a list*:
- [ ] **Paste a list → Check the list.** Expect: *3 domains will run*, a skipped count if any were mailed in the last 30 days,
      *1 not valid* (`10.0.0.1`, refused because it is a private address), and a Hunter line such as *up to 3 credits of N*.
- [ ] **Vanta is not mailed.** It is a competitor on the blocklist: it should end as *Not a fit*, with no Hunter credit spent.
- [ ] **Name the run** `Rehearsal` so it is easy to find later, then **Start the run**.
- [ ] **Watch the run page.** You should see the pulsing *Working live* pill, the ring filling, the step counts moving, and the feed
      saying things like *Read the website*. A company takes about **a minute** to read and score.
- [ ] **Most companies finish as a "maybe".** That is normal when headcount is not on the site (company size scores 0). A "maybe" waits
      for you and costs nothing yet. If one scores 65 or more it goes straight on and spends a credit.

## 2. Decide on the "maybes" (about 5 minutes)

- [ ] Open a company's **Why** page. The top of the page should read in plain sentences: the score, the strongest reasons, pages read.
- [ ] Scroll the evidence: **every point has a quote and the page it came from.** Click one source link to confirm the quote is really there.
- [ ] **Promote** one with a short reason (*Put back in the queue*, with *Promote* chosen). It should **not** re-read the site: the trace
      shows *A person promoted this maybe, so it was not read again*, then *Found the person*, *Chose two pains*, *Wrote the email*.
- [ ] Leave one "maybe" alone on purpose, so you can show that nothing happens without a person.

## 3. The Review desk (about 5 minutes)

- [ ] **Open Review.** The promoted company's draft is waiting. Nothing has been sent.
- [ ] **Read it as the recipient would.** Check: the greeting uses the person's first name; one hook taken from their own site; two
      pains; one small ask; the opt-out line and a **full postal address**; 12 of 12 checks. The hook should be the company's strongest
      signal, not a throwaway line.
- [ ] **Edit** one draft (press **E**): change a sentence. The desk shows how much you changed (a share of the words); an edit must
      still pass all 12 checks or it will not send.
- [ ] **Approve** one (press **A**) and **reject** one with a reason (press **R**; try *wrong person* once). Keyboard: **J/K** to move.
- [ ] **Run the worker** (the *Run the worker now* button, or wait up to 15 minutes for the schedule). The approved email is sent.
- [ ] **Check the test inbox** (the address in Settings; check spam). The email should read as a formal letter (*Dear …*, *Kind regards,*) with a
      professional subject line, and a small *Test delivery* notice **under** it saying it was sent to you only and not to the contact, with
      the contact it would have gone to.
- [ ] **The Why page now shows the decision** ("Approved as written" or "with edits (about N% changed)", with the time).

## 4. The guardrails (about 5 minutes)

Each of these should *refuse*, with a reason, not fail silently.

- [ ] **Do-not-contact.** Settings → *Do not contact* → add a domain from this run with a reason, then start a new run containing it.
      It should be skipped with that reason. Lift it afterwards (lifting adds a new row; history stays).
- [ ] **Recently mailed.** Re-run a domain you already sent to. It is skipped: one email per domain per 30 days.
- [ ] **An unreachable site.** Add a domain that does not exist, for example `zzqx-no-such-company-1234.com`. It should end as
      *needs more* or *failed* with a plain reason, and no email.
- [ ] **Approval switch.** Settings → turn *A person approves each email* **off**, save with a reason, confirm the amber *Approval is off*
      warning appears, then turn it **back on**. (Do not leave it off.)
- [ ] **A model that gets worse.** Quality → *Run the golden set*: ten invented companies with known answers, including a page that tells
      the model what to say. With the real key it is a genuine measurement; a result under the threshold is flagged, not hidden.

## 5. The numbers (about 2 minutes)

- [ ] **Scorecard.** With fewer than 8 decisions it says *Too early to say*, never good news. That is correct. After 8 or more it checks the
      three shutdown rules (over 50% rewritten, over 40% wrong person, costing more time than it saves).
- [ ] **Impact** shows the funnel and time saved *with its working* (an estimate from the assumptions in Settings, not a stopwatch).
- [ ] **Quality** shows this week against last, with *Not enough data* where a sample is too small.
- [ ] **Ask** answers a plain question (*which companies are waiting for me?*) and shows which lookups it used.

## 6. Afterwards

- [ ] Take the screenshots you need (run page, a Why page, the Review desk, the test-mode email, the Scorecard).
- [ ] Nothing needs deleting. Decisions, scores and traces are **append-only** by design, so the rehearsal stays in the history. That is
      why the run is named `Rehearsal`.
- [ ] Note the Hunter credits left (`npm run smoke -- --only hunter`).

---

## If something goes wrong

| What you see | Likely cause | What to do |
|---|---|---|
| Sign-in link says *expired* or *did not work* | Opened in a different browser, or already used | Request a new link and open it in the same browser |
| No sign-in email | Supabase's built-in mailer is rate-limited | Wait a few minutes; check spam |
| Home page shows a setup checklist | Something required is missing | Open the item it names; the ICP sign-off and the Sprinto claim are yours to give |
| A company sits *In progress* and does not move | A step failed and is waiting out a retry back-off | Open its Why page: the exact error is shown at the top. Wait, or put it back in the queue |
| *Gemini … billing / refused the key* | Key wrong, truncated, or the Google account has a balance due | `npm run keys -- --only gemini`, then renew it on Vercel |
| Send fails with *reauthorize* / `invalid_grant` | The Gmail sign-in expired (7 days in Testing mode) | `npm run gmail-token`, then renew on Vercel |
| *Draft ready for your approval* never leaves | Nobody approved it | Open Review |
| The worker never runs | GitHub secrets missing or the app is down | `gh workflow run worker.yml`, then read the run's log |
| Live app is down or old | Deployment problem | `npx vercel deploy --prod --yes --scope mesa-school-of-business` |

### Renewing a key on the live app

Local keys live in `.env.local`; the live app has its own copy in Vercel. After changing a key locally, copy it across without printing it,
then redeploy. For example, for the Gmail token:

```bash
python3 -c "import sys,subprocess;v=[l.split('=',1)[1].strip() for l in open('.env.local') if l.startswith('GMAIL_REFRESH_TOKEN=')][0];subprocess.run(['npx','vercel','env','add','GMAIL_REFRESH_TOKEN','production','--scope','mesa-school-of-business','--force','--sensitive'],input=v,text=True)"
npx vercel deploy --prod --yes --scope mesa-school-of-business
```

## Known limits (say them before anyone asks)

- **Gmail sign-in lasts about 7 days.** Google will not take the app out of *Testing* without a domain we own. Renew it before any demo.
- **Conversion is not measured.** In test mode nobody outside is mailed, so there are no replies to count. The Scorecard says so.
- **Many companies score as a "maybe".** Headcount is often not on a site, and the system does not guess. That is the design: a person decides.
- **Hunter is a small free allowance** (50 searches a month). The pre-run check shows what a run would spend.
- **Free hosting tiers.** Supabase pauses an unused project; Vercel's free plan limits a request to 60 seconds, so the worker does a few steps per call and the schedule does the rest.
- **It is a test-mode system.** Moving to real prospects is a deliberate change by an admin, after review, and the approval step stays on.
