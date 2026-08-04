-- Row Level Security policies only govern which *rows* a role can see; the
-- role still needs standard SQL privileges on the table itself, or every
-- query fails with "permission denied for table ..." before RLS is ever
-- evaluated. Grant the app's two client-facing roles what they need
-- (service_role needs the same treatment — see the next migration).
grant usage on schema public to anon, authenticated;

grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.memories to authenticated;
grant select, insert, update, delete on public.reminders to authenticated;
