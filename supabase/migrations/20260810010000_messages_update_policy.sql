-- messages had SELECT/INSERT/DELETE policies but no UPDATE one, so every
-- embedding write from the cross-conversation recall feature was silently
-- blocked: a Postgres UPDATE filtered out by RLS affects zero rows and
-- raises NO error, so the code looked like it worked while nothing was
-- ever stored. Found by checking the actual database state after a live
-- end-to-end test rather than trusting the feature appearing to work
-- (the test "passed" only because the separate memories feature happened
-- to surface the same fact).
--
-- The UPDATE privilege was already granted to authenticated by the
-- original schema migration; only the policy was missing.
--
-- Owner-scoped in both directions: USING controls which existing rows are
-- visible to update, WITH CHECK stops a row being updated INTO another
-- user's ownership. This deliberately does not widen what a user can
-- already do to their own data — they can already delete their own
-- messages and insert new ones — and RLS confines it to their own rows
-- either way.
create policy "messages_update_own" on public.messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
