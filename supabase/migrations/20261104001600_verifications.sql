-- Sprinto Outbound: checking an address before it is trusted.
-- Hunter sometimes cannot fully verify an address (it "accepts all" mail, so a wrong address looks the same as a right one).
-- A person can pay a credit to check one properly; the answer is kept as a permanent row. Only the outcome is stored, never
-- the address, so these rows hold no personal data and the 90-day rule has nothing to remove from them. The newest row for a
-- contact is what the brief shows; the ledger records the credit it used.

create table public.contact_verifications (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  prospect_id uuid not null references public.prospects (id),
  contact_id uuid not null references public.contacts (id),
  status text not null check (status in ('valid', 'invalid', 'accept_all', 'webmail', 'disposable', 'unknown')),
  score int check (score is null or score between 0 and 100),
  credits numeric not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  created_by uuid
);
call public.make_append_only('public.contact_verifications');
create index contact_verifications_contact_idx on public.contact_verifications (contact_id, seq desc);

alter table public.contact_verifications enable row level security;
create policy contact_verifications_read on public.contact_verifications for select to authenticated using (public.can_read());
-- A hosted project may hand new tables to its anonymous and service roles by default; this table has no business with either.
revoke all on public.contact_verifications from anon, service_role;
grant select on public.contact_verifications to authenticated;
-- No insert policy and no insert grant: record_verification is the only way in.

create function public.record_verification(p_contact uuid, p_status text, p_score int, p_credits numeric default 1)
returns public.contact_verifications language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.contacts;
  p public.prospects;
  r public.contact_verifications;
begin
  if not public.is_human_operator() then raise exception 'Only an operator or admin can verify an address' using errcode = '42501'; end if;
  select * into c from public.contacts where id = p_contact;
  if not found then raise exception 'Unknown contact' using errcode = 'P0001'; end if;
  select * into p from public.prospects where id = c.prospect_id;
  insert into public.contact_verifications (prospect_id, contact_id, status, score, credits)
  values (c.prospect_id, c.id, p_status, p_score, greatest(coalesce(p_credits, 0), 0)) returning * into r;
  insert into public.usage_ledger (run_id, prospect_id, kind, units, note) values (p.run_id, p.id, 'hunter_credits', greatest(coalesce(p_credits, 0), 0), 'Address verification');
  return r;
end $$;

revoke all on function public.record_verification(uuid, text, int, numeric) from public, anon, service_role;
grant execute on function public.record_verification(uuid, text, int, numeric) to authenticated;
