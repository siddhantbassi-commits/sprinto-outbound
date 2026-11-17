-- Sprinto Outbound: who can touch what.
-- Start from nothing. Row-level security is on for every table and the anonymous role has no privileges at all.
-- There is no service-role key in the app, and the service role is stripped of table privileges here too, so even a
-- leaked key could not read or rewrite this data.

-- 1. Strip every default privilege, now and for objects created later.
revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;
-- Postgres gives EXECUTE to PUBLIC on every new function, and a schema-scoped revoke cannot take that away. This one,
-- without "in schema", changes the default for every function this role creates from now on, so a later migration can
-- never leave a function callable by the anonymous role by forgetting to revoke it.
alter default privileges revoke execute on functions from public;
grant usage on schema public to authenticated;

-- 2. Row-level security on every table.
alter table public.profiles enable row level security;
alter table public.settings_versions enable row level security;
alter table public.icp_versions enable row level security;
alter table public.icp_signoffs enable row level security;
alter table public.sprinto_facts_versions enable row level security;
alter table public.runs enable row level security;
alter table public.prospects enable row level security;
alter table public.step_events enable row level security;
alter table public.pages enable row level security;
alter table public.facts enable row level security;
alter table public.scores enable row level security;
alter table public.contacts enable row level security;
alter table public.manual_contacts enable row level security;
alter table public.hunter_cache enable row level security;
alter table public.emails enable row level security;
alter table public.suppressions enable row level security;
alter table public.decisions enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.worker_ticks enable row level security;

-- 3. Reads. Pending people read nothing. Viewers read everything except raw contact details.
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.profiles to authenticated;
grant update (role) on public.profiles to authenticated;

do $$
declare t text;
begin
  foreach t in array array['settings_versions', 'icp_versions', 'icp_signoffs', 'sprinto_facts_versions', 'runs', 'prospects', 'step_events',
    'pages', 'facts', 'scores', 'emails', 'suppressions', 'decisions', 'usage_ledger', 'worker_ticks'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.can_read())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['contacts', 'manual_contacts', 'hunter_cache'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.can_work())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 4. Writes. An admin sets the rules; an operator or admin adds suppressions and decisions and hand-picked contacts;
-- only the worker (or a person) holding a prospect's lease can write results for it.
create policy settings_admin_insert on public.settings_versions for insert to authenticated with check (public.is_admin());
create policy icp_admin_insert on public.icp_versions for insert to authenticated with check (public.is_admin());
create policy icp_signoff_admin_insert on public.icp_signoffs for insert to authenticated with check (public.is_admin());
create policy facts_file_admin_insert on public.sprinto_facts_versions for insert to authenticated with check (public.is_admin());
grant insert on public.settings_versions, public.icp_versions, public.icp_signoffs, public.sprinto_facts_versions to authenticated;

create policy suppressions_insert on public.suppressions for insert to authenticated with check (public.is_human_operator());
create policy decisions_insert on public.decisions for insert to authenticated with check (public.is_human_operator());
create policy manual_contacts_insert on public.manual_contacts for insert to authenticated with check (public.is_human_operator());
grant insert on public.suppressions, public.decisions, public.manual_contacts to authenticated;

create policy pages_insert on public.pages for insert to authenticated with check (public.can_work() and public.holds_lease(prospect_id));
create policy facts_insert on public.facts for insert to authenticated with check (public.can_work() and public.holds_lease(prospect_id));
create policy scores_insert on public.scores for insert to authenticated with check (public.can_work() and public.holds_lease(prospect_id));
create policy contacts_insert on public.contacts for insert to authenticated with check (public.can_work() and public.holds_lease(prospect_id));
create policy emails_insert on public.emails for insert to authenticated with check (public.can_work() and public.holds_lease(prospect_id));
create policy usage_insert on public.usage_ledger for insert to authenticated with check (public.can_work() and (prospect_id is null or public.holds_lease(prospect_id)));
create policy hunter_cache_insert on public.hunter_cache for insert to authenticated with check (public.can_work());
grant insert on public.pages, public.facts, public.scores, public.contacts, public.emails, public.usage_ledger, public.hunter_cache to authenticated;

-- Nothing else is writable. runs, prospects, step_events and worker_ticks are written only by the functions below,
-- and an email's status only by reserve_send and set_email_status.

-- 5. Functions: the helpers policies need, and the API the app calls. The internal helpers (underscore) stay private.
grant execute on function public.current_app_role(), public.can_read(), public.can_work(), public.is_human_operator(), public.is_admin(),
  public.holds_lease(uuid), public.is_suppressed(text, text), public.run_is_paused(uuid), public.is_valid_domain(text) to authenticated;
grant execute on function
  public.create_run(text[], text, text, jsonb),
  public.claim_next_prospect(int),
  public.extend_lease(uuid, int),
  public.release_prospect(uuid),
  public.advance_prospect(uuid, text, jsonb, text, text, int, int, text),
  public.park_prospect(uuid, text, text, text, jsonb, text, text, int, int),
  public.fail_prospect(uuid, text, text, boolean),
  public.reserve_send(uuid),
  public.set_email_status(uuid, text, text, text, text, boolean, text),
  public.sweep_stuck_sends(int),
  public.record_tick(text, int),
  public.run_retention(int),
  public.run_tokens(uuid),
  public.hunter_cached(text, int),
  public.settings_now(),
  public.latest_signed_icp()
to authenticated;

-- 6. Views the app reads. They apply their own role check, so a pending or anonymous caller gets no rows.
grant select on public.contacts_masked, public.current_settings, public.worker_status to authenticated;
