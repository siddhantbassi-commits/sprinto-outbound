-- Sprinto Outbound: the weekly discovery digest.
-- A saved search runs once a week (a scheduled job, or a person pressing "run it now"), finds companies that fit and that
-- nobody has been shown before, and tells the owner. Discover costs no Hunter credit and no model tokens, so this spends
-- nothing; it only reads. Both tables are append-only: the saved search is a new row each time it is changed, and each
-- digest is a row that says what was found and whether the email went out, so what a person was told is never rewritten.

create table public.digest_searches (
  id uuid primary key default gen_random_uuid(),
  version int generated always as identity unique,
  -- Whether the weekly job runs it. A saved search can be switched off without losing its criteria.
  enabled boolean not null,
  -- Shape-checked by the app (regions, sizes, angles, how many); kept here exactly as it was run.
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.digest_searches');

create table public.digests (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  trigger text not null check (trigger in ('cron', 'browser')),
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  -- How many companies Hunter returned across the searches, before the clean-up and before removing ones already shown.
  considered int not null default 0 check (considered >= 0),
  -- Only the companies that were new this time: name, domain, what the site says, why it was suggested.
  found jsonb not null default '[]'::jsonb check (jsonb_typeof(found) = 'array' and jsonb_array_length(found) <= 50),
  by_angle jsonb not null default '{}'::jsonb check (jsonb_typeof(by_angle) = 'object'),
  problems jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array'),
  email_status text not null check (email_status in ('sent', 'failed', 'skipped', 'not_sent')),
  email_note text not null default '' check (length(email_note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.digests');
create index digests_seq_idx on public.digests (seq desc);

alter table public.digest_searches enable row level security;
alter table public.digests enable row level security;
create policy digest_searches_read on public.digest_searches for select to authenticated using (public.can_read());
create policy digests_read on public.digests for select to authenticated using (public.can_read());
-- A hosted project may hand new tables to its anonymous and service roles by default; these tables have no business with either.
revoke all on public.digest_searches, public.digests from anon, service_role;
grant select on public.digest_searches, public.digests to authenticated;
-- No insert policy and no insert grant: the two functions below are the only way in.

-- A person saves, changes or switches off the weekly search.
create function public.set_digest_search(p_criteria jsonb, p_enabled boolean, p_reason text default 'Changed the weekly search')
returns public.digest_searches language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.digest_searches;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can change the weekly search' using errcode = '42501'; end if;
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'object' then raise exception 'The search criteria are not valid' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required' using errcode = 'P0001'; end if;
  insert into public.digest_searches (enabled, criteria, reason) values (coalesce(p_enabled, false), p_criteria, left(btrim(p_reason), 300)) returning * into r;
  return r;
end $$;

-- The scheduled job (the worker's own account) or a person records what a digest found and whether the email went out.
create function public.record_digest(p_trigger text, p_criteria jsonb, p_considered int, p_found jsonb, p_by_angle jsonb, p_problems jsonb, p_email_status text, p_email_note text default '')
returns public.digests language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.digests;
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.digests (trigger, criteria, considered, found, by_angle, problems, email_status, email_note)
  values (p_trigger, p_criteria, greatest(coalesce(p_considered, 0), 0), coalesce(p_found, '[]'::jsonb), coalesce(p_by_angle, '{}'::jsonb), coalesce(p_problems, '[]'::jsonb), p_email_status, left(coalesce(p_email_note, ''), 300))
  returning * into r;
  return r;
end $$;

revoke all on function public.set_digest_search(jsonb, boolean, text) from public, anon, service_role;
revoke all on function public.record_digest(text, jsonb, int, jsonb, jsonb, jsonb, text, text) from public, anon, service_role;
grant execute on function public.set_digest_search(jsonb, boolean, text) to authenticated;
grant execute on function public.record_digest(text, jsonb, int, jsonb, jsonb, jsonb, text, text) to authenticated;
