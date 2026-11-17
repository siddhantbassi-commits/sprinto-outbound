-- Sprinto Outbound: procedures were missed by the lock-down.
-- "revoke all on all functions" in the security migration does not touch procedures, so make_append_only (created before
-- the default-privilege change) stayed executable by PUBLIC and the anonymous role. It is not security definer and does
-- nothing without table ownership, so this closes a gap rather than an exploit. Found by checking the live database against
-- the same rules the local tests check, and the test now covers procedures too.

revoke all on procedure public.make_append_only(regclass, text[]) from public, anon, authenticated, service_role;
