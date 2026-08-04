-- Correction to the previous migration's comment: service_role bypasses RLS
-- policies, but NOT standard table-level SQL privileges — those are a
-- separate mechanism, and this local project's roles didn't have them
-- preconfigured (verified: service_role got "permission denied for table
-- reminders" when queried directly via PostgREST with the service key).
-- The app itself never uses service_role, but Supabase Studio, admin
-- tooling, and any future server-side maintenance script running as
-- service_role need this to work at all.
grant usage on schema public to service_role;

grant all on public.profiles to service_role;
grant all on public.conversations to service_role;
grant all on public.messages to service_role;
grant all on public.memories to service_role;
grant all on public.reminders to service_role;
