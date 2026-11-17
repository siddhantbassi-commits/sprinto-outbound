-- Sprinto Outbound: versioned configuration.
-- Every change is a new row with a reason, so any past run can be replayed against the exact settings, ICP and facts it used.

create table public.settings_versions (
  id uuid primary key default gen_random_uuid(),
  version int generated always as identity unique,
  -- The only address test mode may mail. Null means test mode is not set up, and every send is refused.
  test_to text check (test_to is null or (length(test_to) <= 254 and test_to ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$')),
  sender_name text not null default '',
  sender_title text not null default '',
  postal_address text not null default '',
  daily_send_cap int not null default 20 check (daily_send_cap between 0 and 200),
  max_run_size int not null default 50 check (max_run_size between 1 and 500),
  max_parallel int not null default 3 check (max_parallel between 1 and 10),
  hunter_reserve int not null default 3 check (hunter_reserve >= 0),
  tokens_per_domain int not null default 60000 check (tokens_per_domain > 0),
  tokens_per_run int not null default 400000 check (tokens_per_run > 0),
  mail_cooldown_days int not null default 30 check (mail_cooldown_days >= 0),
  minutes_saved_per_email numeric not null default 20 check (minutes_saved_per_email >= 0),
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.settings_versions');

create table public.icp_versions (
  id uuid primary key default gen_random_uuid(),
  version int generated always as identity unique,
  config jsonb not null,
  blocklist jsonb not null default '{"domains": []}'::jsonb,
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.icp_versions');

-- A run may only use an ICP version that a person has signed off.
create table public.icp_signoffs (
  id uuid primary key default gen_random_uuid(),
  icp_version_id uuid not null references public.icp_versions (id),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.icp_signoffs');

create table public.sprinto_facts_versions (
  id uuid primary key default gen_random_uuid(),
  version int generated always as identity unique,
  content jsonb not null,
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.sprinto_facts_versions');

-- The starting rows. The ICP seed is src/lib/icp/config.ts ICP_V1 and the facts seed is SPRINTO_FACTS_SEED; a test
-- fails if either drifts from this file. Nothing is signed off yet, and test mode has no address, so nothing can send.
insert into public.settings_versions (reason) values ('Initial defaults: test mode not yet configured');
insert into public.icp_versions (config, reason) values ($json${"version":1,"qualifyAt":65,"maybeAt":45,"minChars":600,"minPages":2,"minKnownKeyFacts":5,"points":{"customerData":{"stated":15,"implied":8},"enterprise":{"plan":5,"logos":5,"security":5},"size":{"1-10":4,"11-50":8,"51-200":10,"201-500":6,"501-1000":2,"1000+":0},"status":{"in_progress":25,"none_visible":20,"soc2_type1":15,"iso_only":15,"soc2_type2":5,"soc2_iso":0},"gap":{"eu":3,"health":3,"payments":2,"cap":8},"hiring":{"security_role":7,"it_head":3},"timing":{"recent":8,"friction":7,"market":5},"competitorPenalty":15}}$json$::jsonb, 'ICP v1: the researched starting rubric');
insert into public.sprinto_facts_versions (content, reason) values ($json${"version":1,"items":[{"id":"F1","kind":"audience","claim":"Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies.","sourceUrl":"Case 02 brief (3 Nov 2026)","verifiedBy":null,"verifiedAt":null}],"sender":{"name":"[sender first name]","title":"[sender title]"},"postalAddress":"[postal address]","allowedNumbers":["2","27001","15"]}$json$::jsonb, 'Seed from the case brief; nothing verified yet');

create function public.settings_now() returns public.settings_versions
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.settings_versions order by version desc limit 1
$$;

-- The newest ICP version that someone signed off. A newer unsigned version does not replace it.
create function public.latest_signed_icp() returns public.icp_versions
language sql stable security definer set search_path = public, pg_temp as $$
  select v.* from public.icp_versions v
  where exists (select 1 from public.icp_signoffs s where s.icp_version_id = v.id)
  order by v.version desc limit 1
$$;
