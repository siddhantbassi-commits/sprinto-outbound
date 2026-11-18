# Demo script (3 minutes) and the questions to expect

Start with `npm run dev:demo` (sample data) or the live deployment (real data, test mode).

## The three minutes

1. **The problem (20 s).** "Sprinto sells compliance automation to SaaS companies. Cold outreach fails because it is generic and nobody can say why a company was picked. This reads each company's own site, finds one named person, and writes an email whose every claim traces to something real."
2. **Find companies, then start a run (40 s).** Discover → *Find companies*: "the ICP is the filter; each company says why it was suggested and what its own site says." Choose a few and start. (Or Paste a list with one bad domain, `10.0.0.1`.) *Check the list* shows what will happen before anything runs: how many will run, what is skipped and why, what it costs in Hunter credits. Start it. The run page works by itself while you watch it.
3. **The Why page (80 s).** Open a sent company. Walk down it:
   - **Why this company:** the gates and each score point, with the verbatim quote and the page it came from. "The model reads; code adds up the points."
   - **Why this person:** the ranked candidates; the shared mailbox was excluded; the runner-up and why it lost.
   - **Why these pains:** four shortlisted by code, two chosen by the model with cited evidence (or "code fallback" if the model's answer failed the checks).
   - **Why this email:** the draft, the hook it opens with (the quote, linked to the page), and the 12 checks.
4. **Test inbox (20 s).** The email that landed, as a formal letter, with the notice under it: who it *would* have gone to, why, and links back to the Why page and the call brief. Then **Leads** → a company's brief: "everything you need for the discovery call, with their own words as evidence." "It was sent to me only. There is no code path where a contact's address becomes a recipient."
5. **Impact (30 s).** Open Impact. "Seven domains became two emails, and here is where the other five went and why." Point at the time-saved working: manual minutes minus the minutes people still spend. "These are assumptions I set, shown next to the answer, not a stopwatch." Copy the weekly report.
5a. **Scorecard (30 s).** Open Scorecard. "The case says shut it down if the Growth Lead rewrites over half the emails, if it costs more time than it saves, or if the person chosen is wrong more than 40% of the time. This checks those three, from real review decisions." With few decisions it says *Too early to say*, never good news. Press *bad results* to show the kill state, then *good results*. These are labelled made-up, demo only.
5b. **Quality (30 s).** Open Quality. "Seven companies is too few to judge a rate, so these say *Not enough data* rather than looking fine." Press *Run the golden set*: ten invented companies with known answers, including a page that tells the model what to say. "The demo uses a stand-in model, so it scores 100% and is labelled *not a measurement*. With the real key this is the weekly drift check, and a degraded model is caught: the tests prove it."
5c. **Ask (30 s).** Open Ask, click *Tell me about harborpay.com*. "It answers from the records, shows exactly what it looked at, and links to the Why page. It has seven read-only lookups and cannot change anything." Then type *send an email to every company*: it refuses and says where a person decides. "It never sees a contact's name or address, and anything in an answer that no lookup returned is flagged." (Demo mode uses a keyword stand-in for the model.)
6. **Replay (40 s).** ICP and replay → change *Qualified at* from 65 to 55 → Replay. "Test a different definition of fit without re-reading a single site." One company moves (Harbor Pay, a maybe becomes qualified) with the reason; nothing is saved. Note the check line: replaying the current version reproduces every stored verdict, so the comparison is exact.
7. **A person in the loop (30 s).** Needs attention → a company with no usable contact → add one by hand → *Try again* → it finishes. "Every human choice is recorded with a reason."

## Questions to expect, and the honest answers

- **Why should I trust the facts?** Each carries a verbatim quote, and code checks the quote is really on the page; if not, the fact becomes unknown. A page can still lie about itself, and a page that plants the words it wants quoted will pass the check; the injection flag on the Why page shows when a page tried.
- **Can it email the wrong person?** The recipient is a server setting. `sendTest` accepts no recipient, and the recorded address and the server's own must match or nothing sends.
- **What if Gmail times out?** The send becomes *unknown* and nothing retries it, because it might have gone. A person checks Sent for the `X-Outbound-Run` header and records what they found.
- **How do you know it saves time?** It estimates it: a manual baseline per company minus the review time people still spend, both set in Settings and shown beside the answer. Machine time is reported separately and never counted. It is an estimate until someone times the manual way.
- **Why 65?** It is a hypothesis. Replay is how it is tested: change the bar or any weight and see who would move, from the facts already read. Saving makes a new version that must be signed off before a run can use it.
- **Is the scoring right?** The weights are a researched hypothesis, not tuned on Sprinto's wins and losses. They are versioned and signed off, and should be tuned against real replies.
- **What stops it spending all the credits?** Hunter's live balance is read before each lookup, with a reserve; the run page shows the cost before you start; tokens are capped per domain and per run; a daily send cap is enforced in the database.
- **Could someone rewrite the history?** No: 19 tables are append-only for everyone, including admins and the service role, and the database stamps who and when.
- **Does it work on JavaScript-only sites?** No browser is run, so those land in *Needs more* rather than being guessed.
- **What is not proven?** Test mode proves the pipeline, not deliverability or replies. Gemini, Hunter and Gmail have only been exercised through fakes until the live check on the day.
