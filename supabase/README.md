# Supabase: schema, queue and security

Sixteen migrations, applied in order. They are plain SQL and are tested against a real Postgres (PGlite) on every `npm test`.

| File | What it does |
|---|---|
| `…000100_foundation.sql` | Roles, the profile created for each login, and the three guards every table uses: stamping, append-only, scrub-only |
| `…000200_versions.sql` | Settings, ICP, sign-offs and the Sprinto facts file, each a new row per change, with starting rows |
| `…000300_pipeline.sql` | Runs, prospects, the trace, pages, facts, scores, contacts, emails, suppressions, decisions, usage, heartbeat |
| `…000400_queue.sql` | The queue and the send safety, as functions |
| `…000500_security.sql` | Row-level security on every table, and every grant |
| `…000600_resume.sql` | A person puts a parked prospect back in the queue |
| `…000700_roles.sql` | Changing a role is a recorded act (`set_user_role`), and the direct update grant is withdrawn |
| `…000800_review_minutes.sql` | The review-time assumptions the Impact view subtracts from the time saved |
| `…000900_golden_runs.sql` | The quality watch's memory: one append-only row per run of the golden set, with the model, prompt and ICP version it ran under |
| `…001000_lock_procedures.sql` | Closes a gap found by checking the live database: `revoke … on all functions` skips procedures, so `make_append_only` was executable by the public |
| `…001100_approvals.sql` | Human approval: `settings_versions.require_approval` (on by default), the append-only `email_reviews` table (one decision per email, with how much the person changed it), and `approve_email` / `reject_email` |
| `…001200_discover_source.sql` | A run may start from a Discover search (`runs.source` accepts `discover` alongside `paste` and `csv`); nothing else about who may start one or the caps changes |
| `…001300_outcomes.sql` | What came of a lead: the append-only `lead_outcomes` table (reached out, replied, meeting booked, not interested, bounced, wrong person, with a note and an optional follow-up date) and `log_outcome`, the only way in. A reply or bounce is also written once as the decision Impact already counts, and "not interested" can add the company to the do-not-contact list in the same step |
| `…001400_digest.sql` | The weekly discovery digest: append-only `digest_searches` (each save, switch-on or switch-off is a new version) and `digests` (what each run found and whether the email went out), written only through `set_digest_search` (a person) and `record_digest` (the worker or a person) |
| `…001500_prospect_hints.sql` | What is known about a company before its site is read: append-only `prospect_hints` (today, the size band Hunter Discover found a company under), written only by `set_prospect_hints`, and only for a company in that run that has not been read yet |
| `…001600_verifications.sql` | Paying a Hunter credit to check an address properly: append-only `contact_verifications` (the status and score only, never the address, so the 90-day rule has nothing to remove) written by `record_verification`, which also records the credit in the usage ledger |

## Setting up a project (about 10 minutes, once)

1. Create a Supabase project in the Mumbai region.
2. **Authentication → Providers → Email:** turn **off** "Allow new users to sign up". People are invited, never self-registered. (Even if this is left on, a new login arrives as `pending` and can read nothing.)
3. Apply the migrations in order: `supabase db push`, or paste each file into the SQL editor.
4. Invite yourself, then promote yourself. In the SQL editor:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
5. Create the worker's own account (the scheduler signs in as this user, so there is no service-role key anywhere):
   invite `worker@your-domain`, then

   ```sql
   update public.profiles set role = 'worker' where email = 'worker@your-domain';
   ```
6. As an admin, in the app (or SQL), insert a new `settings_versions` row with the test address, sender name and title, and the postal address; sign off the ICP version; and have a person verify the Sprinto facts file. Until all three are done nothing can send, by design.

## Roles

| Role | Can |
|---|---|
| `pending` | Nothing. Every policy refuses them |
| `viewer` | Read everything except raw contact details (they see `contacts_masked`) |
| `operator` | Everything a viewer can, plus start runs, add suppressions, hand-picked contacts and decisions, resume parked prospects, and resolve an unknown send |
| `admin` | Everything an operator can, plus settings, ICP versions and sign-off, the facts file, and roles. The last admin cannot be demoted |
| `worker` | The scheduler. Claims prospects and writes results for the ones it holds a lease on, through functions. Cannot start runs, edit settings or resolve an unknown send |

## What the database guarantees (so the app cannot get it wrong)

- **History cannot be rewritten.** 19 tables are append-only: no update, delete or truncate for anyone, the service role and the database owner included. The one exception is the 90-day rule, which may blank names and addresses (and nothing else) once.
- **Stamps are the database's.** `created_at` and `created_by` are written by trigger; a caller cannot back-date or impersonate.
- **No back doors.** The `anon` and `service_role` roles have no privilege on any table. Signed-in roles have `SELECT` and a few specific `INSERT`s, and no `UPDATE`, `DELETE` or `TRUNCATE`, except an admin changing a role.
- **Only the lease holder writes results.** Pages, facts, scores, contacts and drafts can be inserted only by the worker holding that prospect's lease.
- **One send.** At most one email per prospect may be `sending`, `sent` or `unknown`. `reserve_send` enforces the daily cap, one email per domain per cooldown, the suppression list, and test mode being configured, under a lock. A send whose outcome is uncertain becomes `unknown` and nothing retries it; only a person, with a reason, can resolve it.
- **Email status moves along legal paths only,** checked for every pair of states, whoever asks.
- **Personal data expires.** `run_retention()` blanks names and addresses after 90 days. The worker calls it each tick.

## Not covered here

- Two workers claiming at the exact same instant can't be exercised in a single-connection test. It rests on `FOR UPDATE SKIP LOCKED` and an advisory lock; watch it on the first live run.
- Row-level security is tested against Postgres 18 (PGlite). Supabase runs a recent Postgres, and its `auth.uid()` is reproduced in `tests/db/shim.sql` from its documented behaviour; confirm with the real thing when the project exists.
