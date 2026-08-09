-- Tracks when a user was last actually in the app, so the home page can
-- tell the difference between "you were here an hour ago" (show the plain
-- composer, don't nag) and "you've been away three weeks" (show a real
-- catch-up: what fired, what finished, what's coming up).
--
-- Nullable with no default: an existing user has no recorded last-active
-- time yet, and defaulting to now() would claim they were just here,
-- suppressing the catch-up for exactly the returning users it's for.
-- Null is read as "unknown, treat as a returning visit".
alter table public.profiles
  add column last_active_at timestamptz;
