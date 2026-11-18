-- Sprinto Outbound: what we already know about a company before its site is read.
-- Hunter Discover finds companies by asking for a size band, so a company it returns is, by Hunter's own data, in that band.
-- Most sites do not state their headcount, which left size unknown and cost points or stopped a company at "needs more".
-- A hint carries that band into the run, labelled as coming from Hunter and not from the site. The scorer only uses it when
-- the site did not state a size, and the Why page says where the figure came from. A hint can only be added before a company
-- has been read, so it can never be added after the fact to change a verdict, and rows are append-only.

create table public.prospect_hints (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id),
  domain text not null check (length(domain) between 3 and 253),
  kind text not null check (kind in ('headcount')),
  value text not null,
  source text not null check (source in ('hunter_discover')),
  created_at timestamptz not null default now(),
  created_by uuid,
  check (kind <> 'headcount' or value in ('1-10', '11-50', '51-200', '201-500', '501-1000', '1000+')),
  unique (run_id, domain, kind)
);
call public.make_append_only('public.prospect_hints');

alter table public.prospect_hints enable row level security;
create policy prospect_hints_read on public.prospect_hints for select to authenticated using (public.can_read());
-- A hosted project may hand new tables to its anonymous and service roles by default; this table has no business with either.
revoke all on public.prospect_hints from anon, service_role;
grant select on public.prospect_hints to authenticated;
-- No insert policy and no insert grant: set_prospect_hints is the only way in.

-- A person starting a run from Discover records the size band each chosen company was found under. Every hint must name a
-- company in that run that has not been read yet; one hint per company per kind (a repeat is ignored, not overwritten).
create function public.set_prospect_hints(p_run uuid, p_hints jsonb)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h jsonb;
  n int := 0;
  added int;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can add hints' using errcode = '42501'; end if;
  if not exists (select 1 from public.runs where id = p_run) then raise exception 'Unknown run' using errcode = 'P0001'; end if;
  if p_hints is null or jsonb_typeof(p_hints) <> 'array' then raise exception 'Hints must be a list' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_hints) > 1000 then raise exception 'Too many hints' using errcode = 'P0001'; end if;
  for h in select * from jsonb_array_elements(p_hints) loop
    if not exists (select 1 from public.prospects where run_id = p_run and domain = h->>'domain' and step = 'queued') then
      raise exception 'A hint must name a company in this run that has not been read yet' using errcode = 'P0001';
    end if;
    insert into public.prospect_hints (run_id, domain, kind, value, source)
    values (p_run, h->>'domain', coalesce(h->>'kind', 'headcount'), h->>'value', 'hunter_discover')
    on conflict (run_id, domain, kind) do nothing;
    get diagnostics added = row_count;
    n := n + added;
  end loop;
  return n;
end $$;

revoke all on function public.set_prospect_hints(uuid, jsonb) from public, anon, service_role;
grant execute on function public.set_prospect_hints(uuid, jsonb) to authenticated;
