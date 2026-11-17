-- Sprinto Outbound: foundation.
-- Roles, the profile row created for each invited person, and the three guards every table builds on:
--   stamp_row      : the database writes created_at and created_by, so a caller cannot back-date or impersonate
--   forbid_change  : append-only tables refuse UPDATE, DELETE and TRUNCATE for everyone, including admins and the service role
--   scrub_only     : the one exception, so the 90-day retention rule can blank personal data without rewriting history

create type public.app_role as enum ('pending', 'viewer', 'operator', 'admin', 'worker');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role public.app_role not null default 'pending',
  created_at timestamptz not null default now()
);

-- Invite-only: signups are switched off in Supabase Auth, and anyone who does get an auth row starts as 'pending',
-- which can read nothing. An admin promotes them.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'pending'::public.app_role)
$$;

-- viewer reads; operator and admin read and act; worker is the scheduler's own account and acts through functions only.
create function public.can_read() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_app_role() in ('viewer', 'operator', 'admin', 'worker') $$;
create function public.can_work() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_app_role() in ('operator', 'admin', 'worker') $$;
create function public.is_human_operator() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_app_role() in ('operator', 'admin') $$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_app_role() = 'admin' $$;

-- The last admin cannot be demoted, so the project can never lock itself out.
create function public.profiles_keep_admin() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.role = 'admin' and new.role <> 'admin' and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
    raise exception 'The last admin cannot be demoted' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger profiles_keep_admin before update of role on public.profiles for each row execute function public.profiles_keep_admin();

create function public.stamp_row() returns trigger language plpgsql as $$
begin
  new.created_at := now();
  new.created_by := auth.uid();
  return new;
end $$;

create function public.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Table % is append-only: % is not allowed', tg_table_name, tg_op using errcode = '42501';
end $$;

-- Allows exactly one kind of UPDATE: setting the named personal-data columns to NULL and stamping scrubbed_at once.
-- Every other column must be unchanged. tg_argv holds the personal-data column names.
create function public.scrub_only() returns trigger language plpgsql as $$
declare
  pii text[] := tg_argv;
  col text;
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Table % is append-only: % is not allowed', tg_table_name, tg_op using errcode = '42501';
  end if;
  if old.scrubbed_at is not null or new.scrubbed_at is null then
    raise exception 'Table %: only a first scrub is allowed', tg_table_name using errcode = '42501';
  end if;
  foreach col in array pii loop
    if to_jsonb(new) -> col <> 'null'::jsonb then
      raise exception 'Table %: % may only be set to NULL', tg_table_name, col using errcode = '42501';
    end if;
  end loop;
  if (to_jsonb(new) - pii - 'scrubbed_at') is distinct from (to_jsonb(old) - pii - 'scrubbed_at') then
    raise exception 'Table % is append-only: only personal data may be scrubbed', tg_table_name using errcode = '42501';
  end if;
  return new;
end $$;

-- Attach the guards to a table. scrub_columns, when given, names the personal-data columns retention may blank.
create procedure public.make_append_only(t regclass, scrub_columns text[] default null)
language plpgsql as $$
declare
  base text := replace(t::text, 'public.', '');
  args text;
begin
  execute format('create trigger %I before insert on %s for each row execute function public.stamp_row()', base || '_stamp', t);
  if scrub_columns is null then
    execute format('create trigger %I before update or delete on %s for each row execute function public.forbid_change()', base || '_no_change', t);
  else
    select string_agg(quote_literal(c), ', ') into args from unnest(scrub_columns) c;
    execute format('create trigger %I before update on %s for each row execute function public.scrub_only(%s)', base || '_scrub_only', t, args);
    execute format('create trigger %I before delete on %s for each row execute function public.forbid_change()', base || '_no_delete', t);
  end if;
  execute format('create trigger %I before truncate on %s for each statement execute function public.forbid_change()', base || '_no_truncate', t);
end $$;

-- A hostname the pipeline may fetch: lowercase labels, a dotted name ending in a letter-led TLD, no reserved suffix.
-- The TypeScript side normalises first; this is the second wall.
create function public.is_valid_domain(d text) returns boolean language sql immutable as $$
  select d is not null
    and length(d) <= 253
    and d ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    and d ~ '\.[a-z][a-z0-9-]{1,62}$'
    and d !~ '\.(localhost|local|internal|lan|home|corp|intranet|invalid|test|example|onion|arpa)$'
$$;
