-- Sprinto Outbound: a person puts a parked prospect back in the queue.
-- A prospect parked for review, held, needing more or failed stays where it is until someone with the authority decides
-- otherwise. That decision is a recorded row with a reason, never an edit. 'unknown' sends are not handled here: only
-- set_email_status can resolve those, because the question is whether an email went out.

create function public.resume_prospect(p_prospect uuid, p_reason text, p_kind text default 'promote')
returns public.prospects language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.prospects;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can resume a prospect' using errcode = '42501'; end if;
  if p_kind not in ('promote', 'rerun') then raise exception 'Unknown decision kind %', p_kind using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required' using errcode = 'P0001'; end if;
  select * into r from public.prospects where id = p_prospect for update;
  if not found then raise exception 'Unknown prospect' using errcode = 'P0001'; end if;
  if r.lane not in ('review', 'held', 'needs_more', 'failed', 'no_contact') then
    raise exception 'A prospect in lane % cannot be resumed', r.lane using errcode = 'P0001';
  end if;
  if public.is_suppressed('domain', r.domain) then raise exception 'This domain is suppressed' using errcode = 'P0001'; end if;
  update public.prospects set lane = 'active', lane_reason = null, attempts = 0, last_error = null, next_run_at = now(), leased_by = null, lease_until = null, updated_at = now()
  where id = p_prospect returning * into r;
  insert into public.decisions (run_id, prospect_id, kind, reason) values (r.run_id, r.id, p_kind, p_reason);
  return r;
end $$;

revoke all on function public.resume_prospect(uuid, text, text) from public, anon;
grant execute on function public.resume_prospect(uuid, text, text) to authenticated;
