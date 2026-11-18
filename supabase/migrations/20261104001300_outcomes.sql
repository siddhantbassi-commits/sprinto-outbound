-- Sprinto Outbound: what happened after a company was researched.
-- A researched company becomes a lead; a person then reaches out (in test mode, by hand), and what comes of it is the number
-- that says whether the ICP and the emails are any good. Each outcome is an append-only row with who recorded it and why, so
-- history is never rewritten: the newest row for a company is where it stands now, and the older rows are how it got there.

create table public.lead_outcomes (
  id uuid primary key default gen_random_uuid(),
  -- The newest row decides, and 'newest' means this number, not a clock that two rows can share.
  seq bigint generated always as identity,
  prospect_id uuid not null references public.prospects (id),
  status text not null check (status in ('reached_out', 'replied', 'meeting_booked', 'not_interested', 'bounced', 'wrong_person')),
  note text not null default '' check (length(note) <= 500),
  -- When to come back to it. Only for a lead that is still open.
  follow_up_on date,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (follow_up_on is null or status in ('reached_out', 'replied', 'meeting_booked'))
);
call public.make_append_only('public.lead_outcomes');
create index lead_outcomes_prospect_idx on public.lead_outcomes (prospect_id, seq desc);

alter table public.lead_outcomes enable row level security;
create policy lead_outcomes_read on public.lead_outcomes for select to authenticated using (public.can_read());
-- A hosted project may hand new tables to its anonymous and service roles by default; this table has no business with either.
revoke all on public.lead_outcomes from anon, service_role;
grant select on public.lead_outcomes to authenticated;
-- No insert policy and no insert grant: log_outcome is the only way in.

-- Records an outcome. A reply or a bounce is also written as the decision the Impact view already counts, once per company, so
-- recording the same thing twice does not count it twice. "Not interested" can also put the company on the do-not-contact list
-- in the same step, so a person's "never again" is not a second job they might forget.
create function public.log_outcome(p_prospect uuid, p_status text, p_note text default '', p_follow_up date default null, p_do_not_contact boolean default false)
returns public.lead_outcomes language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.prospects;
  o public.lead_outcomes;
  decision_kind text;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can record an outcome' using errcode = '42501'; end if;
  select * into p from public.prospects where id = p_prospect;
  if not found then raise exception 'Unknown company' using errcode = 'P0001'; end if;
  if p_status is null or p_status not in ('reached_out', 'replied', 'meeting_booked', 'not_interested', 'bounced', 'wrong_person') then
    raise exception 'Unknown outcome' using errcode = 'P0001';
  end if;
  if p_follow_up is not null and (p_follow_up < current_date or p_follow_up > current_date + 365) then
    raise exception 'The follow-up date must be within the next year' using errcode = 'P0001';
  end if;
  if p_follow_up is not null and p_status not in ('reached_out', 'replied', 'meeting_booked') then
    raise exception 'A closed lead has no follow-up' using errcode = 'P0001';
  end if;
  if coalesce(p_do_not_contact, false) and p_status <> 'not_interested' then
    raise exception 'Only "not interested" can also mean do not contact' using errcode = 'P0001';
  end if;

  insert into public.lead_outcomes (prospect_id, status, note, follow_up_on)
  values (p.id, p_status, left(btrim(coalesce(p_note, '')), 500), p_follow_up) returning * into o;

  decision_kind := case p_status when 'replied' then 'mark_reply' when 'bounced' then 'mark_bounce' else null end;
  if decision_kind is not null and not exists (select 1 from public.decisions d where d.prospect_id = p.id and d.kind = decision_kind) then
    insert into public.decisions (run_id, prospect_id, kind, reason)
    values (p.run_id, p.id, decision_kind, case when decision_kind = 'mark_reply' then 'Recorded a reply' else 'Recorded a bounce' end);
  end if;

  if coalesce(p_do_not_contact, false) then
    if not public.is_suppressed('domain', p.domain) then
      insert into public.suppressions (kind, value, reason) values ('domain', p.domain, 'Not interested' || case when btrim(coalesce(p_note, '')) = '' then '' else ': ' || left(btrim(p_note), 200) end);
    end if;
    insert into public.decisions (run_id, prospect_id, kind, reason) values (p.run_id, p.id, 'do_not_contact', 'Not interested; do not contact again');
  end if;
  return o;
end $$;

revoke all on function public.log_outcome(uuid, text, text, date, boolean) from public, anon, service_role;
grant execute on function public.log_outcome(uuid, text, text, date, boolean) to authenticated;
