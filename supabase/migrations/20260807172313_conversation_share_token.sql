-- Nullable: null means "not shared". Set by the owner via
-- src/app/api/conversations/[conversationId]/share/route.ts (through the
-- normal RLS-scoped client — the existing conversations_update_own policy
-- already covers writing this column, no new policy needed). Read by the
-- public share page via the service-role admin client
-- (src/lib/supabase/admin.ts), which explicitly filters by this exact
-- token — deliberately NOT exposed through any RLS policy granting anon
-- read access, so a policy mistake can't leak a user's other conversations.
alter table public.conversations
  add column share_token text unique;
