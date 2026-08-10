-- Tracks whether a user has completed (or dismissed) the first-run tour.
--
-- Nullable timestamp rather than a boolean: "when did they finish" is
-- strictly more information than "did they", and it costs nothing. Null
-- means not yet done.
--
-- Existing users are deliberately left null, so anyone already using
-- Sofii before onboarding shipped still gets shown it once — they've
-- never seen it either, and the features it explains (cross-conversation
-- memory, documents, hands-free voice) are exactly the ones people were
-- missing.
alter table public.profiles
  add column onboarded_at timestamptz;
