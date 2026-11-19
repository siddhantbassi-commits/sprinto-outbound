-- Sprinto Outbound: a count of the questions asked on the Ask page.
-- Ask spends model time, and its only limit was a counter in each server's memory, which a public link can step around by landing
-- on different servers. This keeps one row per question, written by the database with who asked and when, so a daily limit can be
-- counted from here and holds however many servers there are. History is append-only like everything else.

create table public.ask_log (
  id bigint generated always as identity primary key,
  tokens int not null default 0 check (tokens >= 0),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.ask_log');
create index ask_log_by_idx on public.ask_log (created_by, created_at desc);

alter table public.ask_log enable row level security;
create policy ask_log_read on public.ask_log for select to authenticated using (public.can_read());
-- A hosted project may hand new tables to its anonymous and service roles by default; this table has no business with either.
revoke all on public.ask_log from anon, service_role;
grant select on public.ask_log to authenticated;
-- No insert policy and no insert grant: log_ask is the only way in.

create function public.log_ask(p_tokens int default 0)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can ask' using errcode = '42501'; end if;
  insert into public.ask_log (tokens) values (greatest(0, least(coalesce(p_tokens, 0), 1000000)));
end $$;

revoke all on function public.log_ask(int) from public, anon, service_role;
grant execute on function public.log_ask(int) to authenticated;
