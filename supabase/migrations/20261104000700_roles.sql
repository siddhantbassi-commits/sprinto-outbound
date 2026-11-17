-- Sprinto Outbound: changing someone's role is a recorded act.
-- Until now an admin could update the role column directly. That left no trace of who changed what. From here the only way
-- is set_user_role(), which writes an append-only row first, and the direct update grant is withdrawn.

create table public.role_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  old_role public.app_role not null,
  new_role public.app_role not null,
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.role_changes');
alter table public.role_changes enable row level security;
create policy role_changes_read on public.role_changes for select to authenticated using (public.is_admin());
grant select on public.role_changes to authenticated;

create function public.set_user_role(p_user uuid, p_role public.app_role) returns public.profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old public.app_role;
  r public.profiles;
begin
  if not public.is_admin() then raise exception 'Only an admin can change roles' using errcode = '42501'; end if;
  select role into old from public.profiles where id = p_user for update;
  if not found then raise exception 'Unknown person' using errcode = 'P0001'; end if;
  if old = p_role then raise exception 'They already have that role' using errcode = 'P0001'; end if;
  -- The last-admin guard on profiles still applies to the update below.
  insert into public.role_changes (user_id, old_role, new_role) values (p_user, old, p_role);
  update public.profiles set role = p_role where id = p_user returning * into r;
  return r;
end $$;

revoke all on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

revoke update (role) on public.profiles from authenticated;
drop policy profiles_admin_update on public.profiles;
