-- Sprinto Outbound: a reviewer can receive the test email at their own address, once they have proved they own it.
--
-- Until now every test email could only go to the owner's own address. A reviewer (a professor, say) may want it in their own
-- inbox, but letting a visitor type any address would let a public link make the owner's Gmail write to strangers. So an address
-- is accepted only after a one-time code sent to it is entered, the code is single-purpose and expires, wrong guesses are
-- limited, and every number is capped. Both tables are unreadable through the API (a pending code must not be readable by
-- anyone), and each row is append-only history, stamped by the database.

-- ---------------------------------------------------------------- proof of ownership
create table public.reviewer_checks (
  id bigint generated always as identity primary key,
  address text not null check (length(address) <= 254 and address ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'),
  kind text not null check (kind in ('requested', 'confirmed', 'failed')),
  -- Only on a request: the app's keyed hash of the code, never the code. A stolen row cannot be turned back into a code.
  code_hash text check (code_hash is null or length(code_hash) = 64),
  created_at timestamptz not null default now(),
  created_by uuid,
  check ((kind = 'requested') = (code_hash is not null))
);
call public.make_append_only('public.reviewer_checks');
create index reviewer_checks_address_idx on public.reviewer_checks (address, id desc);
alter table public.reviewer_checks enable row level security;
revoke all on public.reviewer_checks from anon, service_role, authenticated;

-- Which email goes to which reviewer address. One row per approved draft, written only by approve_email.
create table public.email_deliveries (
  id bigint generated always as identity primary key,
  email_id uuid not null unique references public.emails (id),
  address text not null,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.email_deliveries');
alter table public.email_deliveries enable row level security;
revoke all on public.email_deliveries from anon, service_role, authenticated;

-- ---------------------------------------------------------------- the three steps
-- Records that a code was sent to an address. The caps: 3 new addresses a day, 8 codes a day, 3 codes an hour per address.
create function public.request_reviewer_code(p_address text, p_code_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a text := lower(btrim(coalesce(p_address, '')));
  day_start timestamptz := (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can do that' using errcode = '42501'; end if;
  if a !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$' or length(a) > 254 then
    raise exception 'That is not a plain email address' using errcode = 'P0001';
  end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'The code could not be prepared' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('reviewer_checks'));
  if (select count(*) from public.reviewer_checks where kind = 'requested' and created_at >= day_start) >= 8 then
    raise exception 'The reviewer inbox has sent all its codes for today. It starts again tomorrow (UTC)' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.reviewer_checks where address = a and kind = 'requested' and created_at >= day_start)
     and (select count(distinct address) from public.reviewer_checks where kind = 'requested' and created_at >= day_start) >= 3 then
    raise exception 'The reviewer inbox has reached its limit of new addresses for today. It starts again tomorrow (UTC)' using errcode = 'P0001';
  end if;
  if (select count(*) from public.reviewer_checks where address = a and kind = 'requested' and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Three codes have already been sent to that address in the last hour. Use the latest one, or try again later' using errcode = 'P0001';
  end if;
  insert into public.reviewer_checks (address, kind, code_hash) values (a, 'requested', p_code_hash);
end $$;

-- Checks a code against the newest unexpired request. A wrong code is recorded and returns false (a refusal would undo the record);
-- after 5 wrong codes the request is dead and a new one must be asked for.
create function public.confirm_reviewer_code(p_address text, p_code_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a text := lower(btrim(coalesce(p_address, '')));
  req public.reviewer_checks;
  wrong int;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can do that' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('reviewer_checks'));
  select r.* into req from public.reviewer_checks r where r.address = a and r.kind = 'requested' and r.created_at > now() - interval '15 minutes'
    and not exists (select 1 from public.reviewer_checks c where c.address = a and c.kind = 'confirmed' and c.id > r.id)
    order by r.id desc limit 1;
  if not found then raise exception 'There is no code waiting for that address, or it has expired (a code lasts 15 minutes). Ask for a new one' using errcode = 'P0001'; end if;
  select count(*) into wrong from public.reviewer_checks where address = a and kind = 'failed' and id > req.id;
  if wrong >= 5 then raise exception 'Too many wrong codes. Ask for a new one' using errcode = 'P0001'; end if;
  if p_code_hash is not null and p_code_hash = req.code_hash then
    insert into public.reviewer_checks (address, kind) values (a, 'confirmed');
    return true;
  end if;
  insert into public.reviewer_checks (address, kind) values (a, 'failed');
  return false;
end $$;

-- True while an address's confirmation is under 24 hours old.
create function public.reviewer_confirmed(p_address text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return exists (select 1 from public.reviewer_checks where address = lower(btrim(coalesce(p_address, ''))) and kind = 'confirmed' and created_at > now() - interval '24 hours');
end $$;

revoke all on function public.request_reviewer_code(text, text) from public, anon, service_role;
revoke all on function public.confirm_reviewer_code(text, text) from public, anon, service_role;
revoke all on function public.reviewer_confirmed(text) from public, anon, service_role;
grant execute on function public.request_reviewer_code(text, text) to authenticated;
grant execute on function public.confirm_reviewer_code(text, text) to authenticated;
grant execute on function public.reviewer_confirmed(text) to authenticated;

-- ---------------------------------------------------------------- approving to a reviewer's address
-- The old signature goes, so a call with five arguments cannot be ambiguous.
drop function public.approve_email(uuid, text, text, numeric, text);
create function public.approve_email(p_email uuid, p_subject text, p_body text, p_edit_ratio numeric default 0, p_note text default '', p_deliver_to text default null)
returns public.email_reviews language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.emails;
  p public.prospects;
  r public.email_reviews;
  edited boolean;
  ratio numeric;
  dest text := nullif(lower(btrim(coalesce(p_deliver_to, ''))), '');
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can approve an email' using errcode = '42501'; end if;
  select * into e from public.emails where id = p_email for update;
  if not found then raise exception 'Unknown email' using errcode = 'P0001'; end if;
  select * into p from public.prospects where id = e.prospect_id for update;
  if e.status <> 'drafted' then raise exception 'This draft is not waiting for approval' using errcode = 'P0001'; end if;
  if p.lane <> 'review' or p.step <> 'drafted' then raise exception 'This company is not waiting for approval' using errcode = 'P0001'; end if;
  if exists (select 1 from public.email_reviews where email_id = e.id) then raise exception 'This draft has already been decided' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_subject, ''))) = 0 or length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'The subject and body cannot be empty' using errcode = 'P0001'; end if;

  -- Mail goes to the owner's own address unless the approver names a reviewer address that has been proved by a code in the last
  -- 24 hours. The address is recorded with the approval, in this same step, so the worker later sends to exactly that address.
  if dest is not null then
    if not public.reviewer_confirmed(dest) then raise exception 'That address has not been confirmed, or its confirmation has expired (it lasts 24 hours)' using errcode = 'P0001'; end if;
    if (select count(*) from public.email_deliveries where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) >= 10 then
      raise exception 'The reviewer inbox has reached its limit of 10 emails for today. It starts again tomorrow (UTC)' using errcode = 'P0001';
    end if;
    insert into public.email_deliveries (email_id, address) values (e.id, dest);
  end if;

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

revoke all on function public.approve_email(uuid, text, text, numeric, text, text) from public, anon, service_role;
grant execute on function public.approve_email(uuid, text, text, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------- sending reads the recorded address
create or replace function public.reserve_send(p_email uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.settings_versions := public.settings_now();
  e public.emails;
  sent_today int;
  contact_email text;
  deliver text;
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('reserve_send'));
  select * into e from public.emails where id = p_email for update;
  if not found then raise exception 'Unknown email' using errcode = 'P0001'; end if;
  if not public.holds_lease(e.prospect_id) then raise exception 'lease_lost' using errcode = 'P0001'; end if;
  if s.test_to is null then return jsonb_build_object('ok', false, 'reason', 'test_mode_unset'); end if;
  if e.status not in ('drafted', 'failed') then return jsonb_build_object('ok', false, 'reason', 'not_sendable'); end if;
  if e.status = 'failed' and e.send_attempts >= 3 then return jsonb_build_object('ok', false, 'reason', 'too_many_attempts'); end if;
  if public.is_suppressed('domain', e.domain) then return jsonb_build_object('ok', false, 'reason', 'suppressed'); end if;
  select c.email into contact_email from public.contacts c where c.prospect_id = e.prospect_id and c.chosen;
  if contact_email is not null and public.is_suppressed('address', contact_email) then return jsonb_build_object('ok', false, 'reason', 'suppressed'); end if;

  -- A reviewer's own confirmed address, chosen when the draft was approved. Absent for the owner's own approvals.
  select d.address into deliver from public.email_deliveries d where d.email_id = e.id;

  select count(*) into sent_today from public.emails x
  where x.status in ('sending', 'sent', 'unknown') and x.sending_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
  if sent_today >= s.daily_send_cap then return jsonb_build_object('ok', false, 'reason', 'cap_reached'); end if;
  if exists (select 1 from public.emails x where x.domain = e.domain and x.id <> e.id and x.status in ('sending', 'sent', 'unknown')
             and x.sending_at > now() - make_interval(days => s.mail_cooldown_days)) then
    return jsonb_build_object('ok', false, 'reason', 'domain_recently_mailed');
  end if;

  begin
    update public.emails set status = 'sending', sending_at = now(), status_at = now(), send_attempts = send_attempts + 1, send_error = null where id = e.id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_sending_or_sent');
  end;
  return jsonb_build_object('ok', true, 'test_to', s.test_to, 'deliver_to', deliver, 'send_attempts', e.send_attempts + 1);
end $$;
