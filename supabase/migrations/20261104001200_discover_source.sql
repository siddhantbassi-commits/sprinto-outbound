-- A run can now start from a Discover search (companies found for the person) as well as a pasted list or a file.
-- Only the allowed values widen; who may start a run, the caps and the suppression checks are untouched (create_run).
alter table public.runs drop constraint runs_source_check;
alter table public.runs add constraint runs_source_check check (source in ('paste', 'csv', 'discover'));
