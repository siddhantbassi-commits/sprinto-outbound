-- Sprinto Outbound: the pipeline's tables.
-- Working state (prospects, and the status of an email) changes only through functions in the next migration.
-- Everything else is history and is append-only.

-- One per paste or CSV. Records which ICP, facts and settings versions it ran under.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('paste', 'csv')),
  domain_count int not null check (domain_count >= 1),
  icp_version_id uuid not null references public.icp_versions (id),
  facts_version_id uuid not null references public.sprinto_facts_versions (id),
  settings_version_id uuid not null references public.settings_versions (id),
  prompt_versions jsonb not null default '{}'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.runs');

-- One per domain per run. The step is where it is; the lane is where it ended up ('active' means still moving).
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id),
  domain text not null check (public.is_valid_domain(domain)),
  step text not null default 'queued' check (step in ('queued', 'scraped', 'qualified', 'contact_found', 'pains_chosen', 'drafted', 'sent')),
  lane text not null default 'active' check (lane in ('active', 'not_fit', 'needs_more', 'review', 'no_contact', 'held', 'skipped', 'sent', 'unknown', 'failed')),
  lane_reason text,
  attempts int not null default 0 check (attempts >= 0),
  next_run_at timestamptz not null default now(),
  leased_by uuid,
  lease_until timestamptz,
  last_error text,
  score int check (score between 0 and 100),
  verdict text check (verdict in ('qualified', 'maybe', 'not_fit', 'needs_more')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (run_id, domain)
);
create trigger prospects_stamp before insert on public.prospects for each row execute function public.stamp_row();
create index prospects_claim_idx on public.prospects (next_run_at) where lane = 'active';
create index prospects_run_idx on public.prospects (run_id);

-- The trace. One row per step taken, parked, retried or failed. The Why page is this made readable.
create table public.step_events (
  id bigint generated always as identity primary key,
  prospect_id uuid not null references public.prospects (id),
  run_id uuid not null references public.runs (id),
  step text not null check (step in ('create', 'scrape', 'qualify', 'contact', 'pains', 'draft', 'send', 'sweep')),
  status text not null check (status in ('ok', 'parked', 'retry', 'error', 'info')),
  input_hash text,
  output jsonb not null default '{}'::jsonb,
  model text,
  prompt_version text,
  tokens int check (tokens is null or tokens >= 0),
  latency_ms int check (latency_ms is null or latency_ms >= 0),
  error text,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.step_events');
create index step_events_prospect_idx on public.step_events (prospect_id, id);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id),
  url text not null,
  kind text not null,
  status int not null,
  bytes int not null check (bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  title text not null default '',
  text text not null,
  thin boolean not null default false,
  truncated boolean not null default false,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (prospect_id, url)
);
call public.make_append_only('public.pages');

-- One row per extraction pass. The agent loop may add passes; the last is what the score used.
create table public.facts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id),
  pass int not null check (pass >= 1),
  facts jsonb not null,
  grounding jsonb not null default '{}'::jsonb,
  absences jsonb not null default '{}'::jsonb,
  injection jsonb not null default '[]'::jsonb,
  problems jsonb not null default '[]'::jsonb,
  model text,
  prompt_version text,
  truncated boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (prospect_id, pass)
);
call public.make_append_only('public.facts');

-- A replay adds a row with replay = true and never touches the prospect's current score.
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id),
  icp_version_id uuid not null references public.icp_versions (id),
  score int not null check (score between 0 and 100),
  verdict text not null check (verdict in ('qualified', 'maybe', 'not_fit', 'needs_more')),
  parts jsonb not null default '[]'::jsonb,
  gates jsonb not null default '[]'::jsonb,
  missing jsonb not null default '[]'::jsonb,
  flags jsonb not null default '[]'::jsonb,
  reason text not null default '',
  replay boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.scores');

create function public.scores_to_prospect() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not new.replay then
    update public.prospects set score = new.score, verdict = new.verdict, updated_at = now() where id = new.prospect_id;
  end if;
  return new;
end $$;
create trigger scores_to_prospect after insert on public.scores for each row execute function public.scores_to_prospect();

-- Personal data. Retention blanks the name and address after 90 days and keeps the rest of the decision trail.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id),
  source text not null check (source in ('hunter', 'manual')),
  first_name text,
  last_name text,
  position text,
  email text,
  type text check (type in ('personal', 'generic')),
  seniority text check (seniority in ('executive', 'senior', 'junior')),
  department text,
  confidence int check (confidence between 0 and 100),
  verification text,
  rank_score int,
  rank_parts jsonb not null default '[]'::jsonb,
  excluded text,
  chosen boolean not null default false,
  scrubbed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.contacts', array['first_name', 'last_name', 'email']);
create unique index contacts_one_chosen on public.contacts (prospect_id) where chosen;

-- Hand-picked contacts (an Apollo lookup, for example), keyed by domain so they can exist before a run does.
create table public.manual_contacts (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (public.is_valid_domain(domain)),
  first_name text,
  last_name text,
  position text,
  email text,
  scrubbed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.manual_contacts', array['first_name', 'last_name', 'email']);

-- The whole Hunter response per domain. A refresh is a new row; the newest wins. It holds addresses, so retention scrubs it too.
create table public.hunter_cache (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (public.is_valid_domain(domain)),
  response jsonb,
  fetched_at timestamptz not null default now(),
  scrubbed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.hunter_cache', array['response']);
create index hunter_cache_domain_idx on public.hunter_cache (domain, fetched_at desc);

-- A draft is immutable once written. Only its send status moves, and only along the legal paths below.
create table public.emails (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id),
  domain text not null,
  attempt int not null default 1 check (attempt >= 1),
  subject text not null,
  body text not null,
  lint jsonb not null default '[]'::jsonb,
  hook jsonb,
  picks jsonb not null default '[]'::jsonb,
  status text not null default 'drafted' check (status in ('drafted', 'held', 'sending', 'sent', 'unknown', 'failed')),
  status_at timestamptz not null default now(),
  sending_at timestamptz,
  send_attempts int not null default 0 check (send_attempts between 0 and 3),
  gmail_message_id text,
  gmail_thread_id text,
  send_error text,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (prospect_id, attempt)
);

-- No double sends: at most one email per prospect may be sending, sent or unknown.
create unique index emails_one_live_per_prospect on public.emails (prospect_id) where status in ('sending', 'sent', 'unknown');
create index emails_sending_idx on public.emails (sending_at) where status in ('sending', 'sent', 'unknown');

create function public.emails_before_insert() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status not in ('drafted', 'held') then
    raise exception 'A new email must start as drafted or held, not %', new.status using errcode = '42501';
  end if;
  -- The domain comes from the prospect, never from the caller.
  select domain into new.domain from public.prospects where id = new.prospect_id;
  if new.domain is null then raise exception 'Unknown prospect' using errcode = '23503'; end if;
  new.created_at := now();
  new.created_by := auth.uid();
  new.status_at := now();
  new.sending_at := null; new.send_attempts := 0; new.gmail_message_id := null; new.gmail_thread_id := null; new.send_error := null;
  return new;
end $$;
create trigger emails_before_insert before insert on public.emails for each row execute function public.emails_before_insert();

create function public.emails_guard_update() returns trigger language plpgsql as $$
declare
  legal boolean;
begin
  if (to_jsonb(new) - array['status', 'status_at', 'sending_at', 'send_attempts', 'gmail_message_id', 'gmail_thread_id', 'send_error'])
     is distinct from (to_jsonb(old) - array['status', 'status_at', 'sending_at', 'send_attempts', 'gmail_message_id', 'gmail_thread_id', 'send_error']) then
    raise exception 'A drafted email cannot be edited; only its status moves' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    legal := (old.status, new.status) in (
      ('drafted', 'sending'), ('failed', 'sending'), ('sending', 'sent'), ('sending', 'unknown'), ('sending', 'failed'),
      ('unknown', 'sent'), ('unknown', 'failed'), ('held', 'drafted')
    );
    if not legal then
      raise exception 'Illegal email status change % to %', old.status, new.status using errcode = '42501';
    end if;
  end if;
  if new.send_attempts < old.send_attempts then
    raise exception 'The send attempt count cannot go down' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger emails_guard_update before update on public.emails for each row execute function public.emails_guard_update();
create trigger emails_no_delete before delete on public.emails for each row execute function public.forbid_change();
create trigger emails_no_truncate before truncate on public.emails for each statement execute function public.forbid_change();

-- Do not contact. Lifting is a new row, not an edit. The newest row for a value decides.
create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  -- The newest row decides, and 'newest' means this number, not a clock that two rows can share.
  seq bigint generated always as identity,
  kind text not null check (kind in ('domain', 'address')),
  value text not null check (value = lower(btrim(value)) and length(value) between 3 and 254 and value !~ '\s'),
  action text not null default 'add' check (action in ('add', 'lift')),
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.suppressions');
create index suppressions_value_idx on public.suppressions (kind, value, seq desc);

-- Every human choice, each with a reason.
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  run_id uuid references public.runs (id),
  prospect_id uuid references public.prospects (id),
  kind text not null check (kind in ('promote', 'skip', 'rerun', 'mark_reply', 'mark_bounce', 'do_not_contact', 'pause_run', 'resume_run', 'resolve_unknown_sent', 'resolve_unknown_failed')),
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid,
  check (run_id is not null or prospect_id is not null)
);
call public.make_append_only('public.decisions');

-- Hunter credits, Gemini tokens and Gmail sends, per prospect, so budgets and cost views come from rows and not from guesses.
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs (id),
  prospect_id uuid references public.prospects (id),
  kind text not null check (kind in ('gemini_tokens', 'hunter_credits', 'gmail_send')),
  units numeric not null check (units >= 0),
  model text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.usage_ledger');
create index usage_ledger_run_idx on public.usage_ledger (run_id, kind);

-- Proof the scheduler is alive. The app warns when the newest row is old; it never shows an all-clear it did not check.
create table public.worker_ticks (
  id bigint generated always as identity primary key,
  source text not null check (source in ('cron', 'browser')),
  processed int not null default 0 check (processed >= 0),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.worker_ticks');
