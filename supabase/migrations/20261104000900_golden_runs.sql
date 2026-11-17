-- Sprinto Outbound: the quality watch's memory.
-- Each time the golden set is run (a person pressed the button, or the weekly job ran) one row is kept: what was measured,
-- under which model, prompt and ICP version, and the per-case detail. Append-only like the rest of the history, so a bad
-- week cannot be tidied away afterwards.
--
-- "source" says what read the fixtures. A 'scripted' run used the built-in stand-in model, which answers from the known
-- truth: it proves the plumbing works and says nothing about the real model, so the page labels it and never counts it.

create table public.golden_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('manual', 'weekly')),
  source text not null check (source in ('live', 'scripted')),
  models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array'),
  prompt_version text not null check (length(prompt_version) between 1 and 80),
  icp_version_id uuid references public.icp_versions (id),
  cases int not null check (cases > 0),
  accuracy numeric not null check (accuracy between 0 and 1),
  wrong_rate numeric not null check (wrong_rate between 0 and 1),
  verdict_agreement numeric not null check (verdict_agreement between 0 and 1),
  spurious int not null check (spurious >= 0),
  tokens int not null check (tokens >= 0),
  status text not null check (status in ('pass', 'warn', 'fail')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  detail jsonb not null default '[]'::jsonb check (jsonb_typeof(detail) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.golden_runs');
create index golden_runs_created_idx on public.golden_runs (created_at desc);

alter table public.golden_runs enable row level security;
create policy golden_runs_read on public.golden_runs for select to authenticated using (public.can_read());
-- Anyone who can work the queue may record a run (an operator pressing the button, the weekly job as the worker).
create policy golden_runs_insert on public.golden_runs for insert to authenticated with check (public.can_work());
grant select, insert on public.golden_runs to authenticated;
