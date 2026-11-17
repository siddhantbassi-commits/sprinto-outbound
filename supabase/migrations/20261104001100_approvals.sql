-- Sprinto Outbound: a person approves each email before it can be sent.
-- The case's own boundary: the system researches and drafts, the Growth Lead decides what goes out. With the setting on
-- (it is on by default) a finished draft waits for a person, who approves it (as written or edited) or rejects it with a
-- reason. Every decision is an append-only row that also records how much the person changed, because the share of
-- drafts that had to be rewritten is the number that says whether the system is saving time or only moving it.

alter table public.settings_versions add column require_approval boolean not null default true;

-- current_settings was created with "select *", which Postgres expands once, at creation, so it would not show the new
-- column. The app reads the table directly, but anyone querying the view should see the same row, so refresh it. Replacing
-- a view keeps its grants.
create or replace view public.current_settings as select * from public.settings_versions where public.can_read() order by version desc limit 1;

create table public.email_reviews (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.emails (id),
  prospect_id uuid not null references public.prospects (id),
  action text not null check (action in ('approve', 'reject')),
  -- The text that will be (or would have been) sent. For an approval it is the final wording, edited or not.
  subject text not null check (length(btrim(subject)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 6000),
  -- 0 means sent as drafted; 1 means everything changed. Measured on words, by the app, and kept as the person's own record.
  edit_ratio numeric not null default 0 check (edit_ratio between 0 and 1),
  -- False when the person rejected because the contact was the wrong one: the measure behind "contact accuracy".
  contact_ok boolean not null default true,
  reason text not null default '' check (length(reason) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.email_reviews');
-- One decision per draft. A rejected draft is not decided again; a new draft (a new attempt) gets its own.
create unique index email_reviews_one_per_email on public.email_reviews (email_id);
create index email_reviews_prospect_idx on public.email_reviews (prospect_id);

alter table public.email_reviews enable row level security;
create policy email_reviews_read on public.email_reviews for select to authenticated using (public.can_read());
grant select on public.email_reviews to authenticated;
-- No insert policy and no insert grant: the two functions below are the only way in.

create function public.approve_email(p_email uuid, p_subject text, p_body text, p_edit_ratio numeric default 0, p_note text default '')
returns public.email_reviews language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.emails;
  p public.prospects;
  r public.email_reviews;
  edited boolean;
  ratio numeric;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can approve an email' using errcode = '42501'; end if;
  select * into e from public.emails where id = p_email for update;
  if not found then raise exception 'Unknown email' using errcode = 'P0001'; end if;
  select * into p from public.prospects where id = e.prospect_id for update;
  if e.status <> 'drafted' then raise exception 'This draft is not waiting for approval' using errcode = 'P0001'; end if;
  if p.lane <> 'review' or p.step <> 'drafted' then raise exception 'This company is not waiting for approval' using errcode = 'P0001'; end if;
  if exists (select 1 from public.email_reviews where email_id = e.id) then raise exception 'This draft has already been decided' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_subject, ''))) = 0 or length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'The subject and body cannot be empty' using errcode = 'P0001'; end if;

  edited := p_subject is distinct from e.subject or p_body is distinct from e.body;
  -- Unchanged text is zero by definition; changed text is never reported as zero.
  ratio := case when not edited then 0 else greatest(least(coalesce(p_edit_ratio, 0), 1), 0.001) end;
  insert into public.email_reviews (email_id, prospect_id, action, subject, body, edit_ratio, contact_ok, reason)
  values (e.id, p.id, 'approve', p_subject, p_body, ratio, true, left(coalesce(p_note, ''), 300)) returning * into r;

  update public.prospects set lane = 'active', lane_reason = null, next_run_at = now(), leased_by = null, lease_until = null, last_error = null, updated_at = now() where id = p.id;
  insert into public.decisions (run_id, prospect_id, kind, reason)
  values (p.run_id, p.id, 'promote', case when edited then 'Approved the draft, with edits' else 'Approved the draft as written' end);
  return r;
end $$;

create function public.reject_email(p_email uuid, p_reason text, p_wrong_contact boolean default false)
returns public.email_reviews language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.emails;
  p public.prospects;
  r public.email_reviews;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can reject an email' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required' using errcode = 'P0001'; end if;
  select * into e from public.emails where id = p_email for update;
  if not found then raise exception 'Unknown email' using errcode = 'P0001'; end if;
  select * into p from public.prospects where id = e.prospect_id for update;
  if e.status <> 'drafted' then raise exception 'This draft is not waiting for approval' using errcode = 'P0001'; end if;
  if p.lane <> 'review' or p.step <> 'drafted' then raise exception 'This company is not waiting for approval' using errcode = 'P0001'; end if;
  if exists (select 1 from public.email_reviews where email_id = e.id) then raise exception 'This draft has already been decided' using errcode = 'P0001'; end if;

  insert into public.email_reviews (email_id, prospect_id, action, subject, body, edit_ratio, contact_ok, reason)
  values (e.id, p.id, 'reject', e.subject, e.body, 0, not coalesce(p_wrong_contact, false), left(btrim(p_reason), 300)) returning * into r;
  update public.prospects set lane = 'skipped', lane_reason = left('Rejected at review: ' || btrim(p_reason), 500), leased_by = null, lease_until = null, updated_at = now() where id = p.id;
  insert into public.decisions (run_id, prospect_id, kind, reason) values (p.run_id, p.id, 'skip', left('Rejected the draft: ' || btrim(p_reason), 300));
  return r;
end $$;

revoke all on function public.approve_email(uuid, text, text, numeric, text) from public, anon, service_role;
revoke all on function public.reject_email(uuid, text, boolean) from public, anon, service_role;
grant execute on function public.approve_email(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.reject_email(uuid, text, boolean) to authenticated;
