-- Sprinto Outbound: what a person's time costs, for the Impact view.
-- "Time saved" is the manual minutes a company would have taken (minutes_saved_per_email, the baseline) minus the minutes a
-- person still spends: reading each email and making each decision. Both are assumptions an admin sets and can change, with
-- a reason, like every other setting; the Impact page shows them next to the answer so nobody mistakes them for measurements.

alter table public.settings_versions
  add column review_minutes_per_email numeric not null default 1.5 check (review_minutes_per_email between 0 and 60),
  add column review_minutes_per_decision numeric not null default 2 check (review_minutes_per_decision between 0 and 60);
