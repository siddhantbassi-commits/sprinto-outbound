-- Sprinto Outbound: the queue and the send safety, as database functions.
-- Callers cannot move a prospect, write a trace row or change an email's status by any other route (see the grants in the
-- last migration). Every function checks the caller's role from the profiles table, and every one pins its search_path.

create function public.holds_lease(p_prospect uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.prospects where id = p_prospect and leased_by = auth.uid() and lease_until > now())
$$;

-- Is a domain or address currently suppressed? The newest row for the value decides, so a lift undoes an add.
create function public.is_suppressed(p_kind text, p_value text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select action = 'add' from public.suppressions where kind = p_kind and value = lower(btrim(p_value)) order by seq desc limit 1), false)
$$;

create function public.run_is_paused(p_run uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select kind = 'pause_run' from public.decisions where run_id = p_run and kind in ('pause_run', 'resume_run') order by seq desc limit 1), false)
$$;

-- Internal: one trace row. Not callable by the API roles.
create function public._event(p_prospect uuid, p_step text, p_status text, p_output jsonb default '{}'::jsonb, p_model text default null,
  p_prompt_version text default null, p_tokens int default null, p_latency int default null, p_input_hash text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.step_events (prospect_id, run_id, step, status, input_hash, output, model, prompt_version, tokens, latency_ms, error)
  select p.id, p.run_id, p_step, p_status, p_input_hash, coalesce(p_output, '{}'::jsonb), p_model, p_prompt_version, p_tokens, p_latency, left(p_error, 500)
  from public.prospects p where p.id = p_prospect;
end $$;

create function public.create_run(p_domains text[], p_source text, p_note text default '', p_prompt_versions jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.settings_versions := public.settings_now();
  icp public.icp_versions := public.latest_signed_icp();
  facts_id uuid;
  domains text[];
  bad text[];
  run_id uuid;
  d text;
  pid uuid;
  skip_reason text;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can start a run' using errcode = '42501'; end if;
  if icp.id is null then raise exception 'No ICP version has been signed off yet' using errcode = 'P0001'; end if;
  select array_agg(distinct lower(btrim(x))) into domains from unnest(coalesce(p_domains, '{}')) x where btrim(x) <> '';
  if domains is null or cardinality(domains) = 0 then raise exception 'A run needs at least one domain' using errcode = 'P0001'; end if;
  if cardinality(domains) > s.max_run_size then
    raise exception 'A run may hold at most % domains (this one has %)', s.max_run_size, cardinality(domains) using errcode = 'P0001';
  end if;
  select array_agg(x) into bad from unnest(domains) x where not public.is_valid_domain(x);
  if bad is not null then raise exception 'Not valid domains: %', array_to_string(bad[1:5], ', ') using errcode = 'P0001'; end if;

  select id into facts_id from public.sprinto_facts_versions order by version desc limit 1;
  insert into public.runs (source, domain_count, icp_version_id, facts_version_id, settings_version_id, prompt_versions, note)
  values (p_source, cardinality(domains), icp.id, facts_id, s.id, coalesce(p_prompt_versions, '{}'::jsonb), left(coalesce(p_note, ''), 500))
  returning id into run_id;

  foreach d in array domains loop
    skip_reason := null;
    if public.is_suppressed('domain', d) then
      skip_reason := 'Suppressed: do not contact';
    elsif exists (select 1 from public.emails e where e.domain = d and e.status in ('sending', 'sent', 'unknown')
                  and e.sending_at > now() - make_interval(days => s.mail_cooldown_days)) then
      skip_reason := format('Already mailed within the last %s days', s.mail_cooldown_days);
    end if;
    insert into public.prospects (run_id, domain, lane, lane_reason)
    values (run_id, d, case when skip_reason is null then 'active' else 'skipped' end, skip_reason)
    returning id into pid;
    perform public._event(pid, 'create', case when skip_reason is null then 'ok' else 'parked' end,
      jsonb_build_object('domain', d, 'skipped', skip_reason));
  end loop;
  return run_id;
end $$;

-- Takes the next due prospect and leases it. Up to settings.max_parallel can be leased at once; a crashed worker's
-- lease simply runs out and the prospect becomes claimable again. Returns no row when there is nothing to do.
create function public.claim_next_prospect(p_lease_seconds int default 120)
returns setof public.prospects language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.settings_versions := public.settings_now();
  busy int;
  r public.prospects;
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('claim_next_prospect'));
  select count(*) into busy from public.prospects where lane = 'active' and lease_until > now();
  if busy >= s.max_parallel then return; end if;
  select p.* into r from public.prospects p
  where p.lane = 'active' and p.next_run_at <= now() and (p.lease_until is null or p.lease_until <= now())
    and not public.run_is_paused(p.run_id)
  order by p.next_run_at, p.created_at
  for update skip locked limit 1;
  if not found then return; end if;
  update public.prospects set leased_by = auth.uid(), lease_until = now() + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds, 120), 600))), updated_at = now()
  where id = r.id returning * into r;
  return next r;
end $$;

create function public.extend_lease(p_prospect uuid, p_seconds int default 120) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare t timestamptz;
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.prospects set lease_until = now() + make_interval(secs => greatest(10, least(p_seconds, 600))), updated_at = now()
  where id = p_prospect and leased_by = auth.uid() and lease_until > now() returning lease_until into t;
  if t is null then raise exception 'lease_lost' using errcode = 'P0001'; end if;
  return t;
end $$;

-- Gives a prospect back without changing it, for a worker that is shutting down.
create function public.release_prospect(p_prospect uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.prospects set leased_by = null, lease_until = null, updated_at = now() where id = p_prospect and leased_by = auth.uid();
end $$;

-- Internal: the lease and step checks every step function shares. Returns the locked row.
create function public._locked(p_prospect uuid, p_from text) returns public.prospects
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.prospects;
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into r from public.prospects where id = p_prospect for update;
  if not found then raise exception 'Unknown prospect' using errcode = 'P0001'; end if;
  if r.leased_by is distinct from auth.uid() or r.lease_until is null or r.lease_until <= now() then raise exception 'lease_lost' using errcode = 'P0001'; end if;
  if r.lane <> 'active' then raise exception 'not_active' using errcode = 'P0001'; end if;
  if r.step <> p_from then raise exception 'step_mismatch' using errcode = 'P0001'; end if;
  return r;
end $$;

create function public._action(p_step text) returns text language sql immutable as $$
  select case p_step when 'queued' then 'scrape' when 'scraped' then 'qualify' when 'qualified' then 'contact'
    when 'contact_found' then 'pains' when 'pains_chosen' then 'draft' when 'drafted' then 'send' end $$;

-- A step finished: record it and move to the next step. 'drafted' is left by the email functions, never here.
create function public.advance_prospect(p_prospect uuid, p_from text, p_output jsonb default '{}'::jsonb, p_model text default null,
  p_prompt_version text default null, p_tokens int default null, p_latency int default null, p_input_hash text default null)
returns public.prospects language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.prospects := public._locked(p_prospect, p_from);
  nxt text;
begin
  nxt := case p_from when 'queued' then 'scraped' when 'scraped' then 'qualified' when 'qualified' then 'contact_found'
    when 'contact_found' then 'pains_chosen' when 'pains_chosen' then 'drafted' end;
  if nxt is null then raise exception 'A prospect at % cannot be advanced this way', p_from using errcode = 'P0001'; end if;
  update public.prospects set step = nxt, attempts = 0, next_run_at = now(), leased_by = null, lease_until = null, last_error = null, updated_at = now()
  where id = p_prospect returning * into r;
  perform public._event(p_prospect, public._action(p_from), 'ok', p_output, p_model, p_prompt_version, p_tokens, p_latency, p_input_hash);
  return r;
end $$;

-- A step ended the prospect's journey for a stated reason (not a fit, needs more, no contact, held for a person).
create function public.park_prospect(p_prospect uuid, p_from text, p_lane text, p_reason text, p_output jsonb default '{}'::jsonb,
  p_model text default null, p_prompt_version text default null, p_tokens int default null, p_latency int default null)
returns public.prospects language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.prospects := public._locked(p_prospect, p_from);
begin
  if p_lane not in ('not_fit', 'needs_more', 'review', 'no_contact', 'held', 'skipped') then
    raise exception 'Cannot park in lane %', p_lane using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required' using errcode = 'P0001'; end if;
  update public.prospects set lane = p_lane, lane_reason = left(p_reason, 500), leased_by = null, lease_until = null, updated_at = now()
  where id = p_prospect returning * into r;
  perform public._event(p_prospect, public._action(p_from), 'parked', coalesce(p_output, '{}'::jsonb) || jsonb_build_object('lane', p_lane, 'reason', left(p_reason, 500)), p_model, p_prompt_version, p_tokens, p_latency);
  return r;
end $$;

-- A step failed. Retryable failures wait (30s, 60s) and try again; the third failure, or a non-retryable one, ends in 'failed'
-- with the error. Backoff doubles each time.
create function public.fail_prospect(p_prospect uuid, p_from text, p_error text, p_retryable boolean default true)
returns public.prospects language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.prospects := public._locked(p_prospect, p_from);
  n int := r.attempts + 1;
  final boolean := (not p_retryable) or n >= 3;
begin
  update public.prospects set attempts = n, last_error = left(p_error, 500), leased_by = null, lease_until = null, updated_at = now(),
    lane = case when final then 'failed' else lane end,
    lane_reason = case when final then left(p_error, 500) else lane_reason end,
    next_run_at = case when final then next_run_at else now() + make_interval(secs => 30 * power(2, n - 1)::int) end
  where id = p_prospect returning * into r;
  perform public._event(p_prospect, public._action(p_from), case when final then 'error' else 'retry' end, jsonb_build_object('attempt', n), null, null, null, null, null, p_error);
  return r;
end $$;

-- Reserves the one send. All checks happen under a lock, so two workers cannot both pass the daily cap.
-- Returns {ok, reason, test_to}. A refusal is an answer, not an error; the caller parks the prospect.
create function public.reserve_send(p_email uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.settings_versions := public.settings_now();
  e public.emails;
  sent_today int;
  contact_email text;
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
  return jsonb_build_object('ok', true, 'test_to', s.test_to, 'send_attempts', e.send_attempts + 1);
end $$;

-- Records the outcome of a send. 'unknown' is never retried by anything: only a person can resolve it, with a reason,
-- after checking Sent for the X-Outbound-Run header.
create function public.set_email_status(p_email uuid, p_status text, p_message_id text default null, p_thread_id text default null,
  p_error text default null, p_retryable boolean default false, p_reason text default null)
returns public.emails language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.emails;
  p public.prospects;
  was text;
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into e from public.emails where id = p_email for update;
  if not found then raise exception 'Unknown email' using errcode = 'P0001'; end if;
  was := e.status;
  if p_status not in ('sent', 'unknown', 'failed') then raise exception 'Cannot set status %', p_status using errcode = 'P0001'; end if;
  select * into p from public.prospects where id = e.prospect_id for update;

  if was = 'unknown' then
    if not public.is_human_operator() then raise exception 'Only a person can resolve an unknown send' using errcode = '42501'; end if;
    if p_status = 'unknown' then raise exception 'Already unknown' using errcode = 'P0001'; end if;
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required to resolve an unknown send' using errcode = 'P0001'; end if;
    insert into public.decisions (prospect_id, run_id, kind, reason)
    values (e.prospect_id, p.run_id, case when p_status = 'sent' then 'resolve_unknown_sent' else 'resolve_unknown_failed' end, p_reason);
  elsif was <> 'sending' then
    raise exception 'An email that is % cannot be set to %', was, p_status using errcode = 'P0001';
  end if;

  update public.emails set status = p_status, status_at = now(),
    gmail_message_id = case when p_status = 'sent' then p_message_id else gmail_message_id end,
    gmail_thread_id = case when p_status = 'sent' then p_thread_id else gmail_thread_id end,
    send_error = case when p_status = 'sent' then null else left(p_error, 500) end
  where id = p_email returning * into e;

  if p_status = 'sent' then
    update public.prospects set step = 'sent', lane = 'sent', lane_reason = null, leased_by = null, lease_until = null, updated_at = now() where id = e.prospect_id;
    insert into public.usage_ledger (run_id, prospect_id, kind, units) values (p.run_id, p.id, 'gmail_send', 1);
  elsif p_status = 'unknown' then
    update public.prospects set lane = 'unknown', lane_reason = left(coalesce(p_error, 'The send may or may not have gone out'), 500), leased_by = null, lease_until = null, updated_at = now() where id = e.prospect_id;
  elsif p_retryable and e.send_attempts < 3 then
    update public.prospects set lane = 'active', next_run_at = now() + make_interval(secs => 30 * power(2, e.send_attempts - 1)::int), leased_by = null, lease_until = null, last_error = left(p_error, 500), updated_at = now() where id = e.prospect_id;
  else
    update public.prospects set lane = 'failed', lane_reason = left(coalesce(p_error, 'The send failed'), 500), leased_by = null, lease_until = null, updated_at = now() where id = e.prospect_id;
  end if;

  perform public._event(e.prospect_id, 'send', case p_status when 'sent' then 'ok' when 'unknown' then 'error' else 'error' end,
    jsonb_build_object('email', e.id, 'status', p_status, 'was', was, 'message_id', e.gmail_message_id), null, null, null, null, null, p_error);
  return e;
end $$;

-- A send that was reserved but never reported (a crashed worker) cannot be known to have failed. It becomes 'unknown'.
create function public.sweep_stuck_sends(p_minutes int default 10) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := 0;
  e record;
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  for e in select id, prospect_id from public.emails where status = 'sending' and sending_at < now() - make_interval(mins => greatest(p_minutes, 1)) for update loop
    update public.emails set status = 'unknown', status_at = now(), send_error = 'No result was recorded, so the send may or may not have gone out' where id = e.id;
    update public.prospects set lane = 'unknown', lane_reason = 'No result was recorded for this send', leased_by = null, lease_until = null, updated_at = now() where id = e.prospect_id;
    perform public._event(e.prospect_id, 'sweep', 'error', jsonb_build_object('email', e.id), null, null, null, null, null, 'Send never reported');
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.record_tick(p_source text, p_processed int default 0) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.worker_ticks (source, processed) values (p_source, greatest(p_processed, 0));
end $$;

-- The 90-day rule: blank names and addresses, keep everything else. Safe to run daily; it only touches rows not yet scrubbed.
create function public.run_retention(p_days int default 90) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c int; m int; h int; cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not public.can_work() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.contacts set first_name = null, last_name = null, email = null, scrubbed_at = now() where scrubbed_at is null and created_at < cutoff;
  get diagnostics c = row_count;
  update public.manual_contacts set first_name = null, last_name = null, email = null, scrubbed_at = now() where scrubbed_at is null and created_at < cutoff;
  get diagnostics m = row_count;
  update public.hunter_cache set response = null, scrubbed_at = now() where scrubbed_at is null and created_at < cutoff;
  get diagnostics h = row_count;
  return jsonb_build_object('contacts', c, 'manual_contacts', m, 'hunter_cache', h);
end $$;

-- Tokens used so far in a run, for the per-run cap.
create function public.run_tokens(p_run uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(units), 0) from public.usage_ledger where run_id = p_run and kind = 'gemini_tokens' and public.can_read()
$$;

-- Newest Hunter response for a domain, if any and not older than p_days.
create function public.hunter_cached(p_domain text, p_days int default 30) returns public.hunter_cache
language sql stable security definer set search_path = public, pg_temp as $$
  select h.* from public.hunter_cache h
  where h.domain = lower(p_domain) and h.fetched_at > now() - make_interval(days => p_days) and public.can_work()
  order by h.fetched_at desc, h.id desc limit 1
$$;

-- Viewers see contacts with the address masked; operators and admins read the table itself.
create view public.contacts_masked as
  select id, prospect_id, source, left(first_name, 1) || '.' as first_initial, position, type, seniority, department, confidence, verification,
         case when email is null then null else left(email, 1) || '***@' || split_part(email, '@', 2) end as email_masked,
         rank_score, rank_parts, excluded, chosen, scrubbed_at, created_at
  from public.contacts where public.can_read();

create view public.current_settings as select * from public.settings_versions where public.can_read() order by version desc limit 1;
create view public.worker_status as
  select (select max(created_at) from public.worker_ticks) as last_tick, now() as checked_at where public.can_read();
