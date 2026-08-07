-- Table-level grants for the tables added in
-- 20260807161425_push_and_briefings.sql — RLS policies alone aren't
-- sufficient (see the reasoning already captured in
-- 20260804060429_grant_table_privileges.sql and
-- 20260804063153_grant_service_role_privileges.sql), and this one was
-- missed on that migration itself: verified live, the client-side
-- subscribe flow failed with "permission denied for table
-- push_subscriptions" until this grant was added.
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

grant select on public.briefings to authenticated;
grant all on public.briefings to service_role;
