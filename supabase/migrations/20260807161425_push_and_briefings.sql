-- Web Push subscriptions (one row per browser/device the user has enabled
-- notifications on) and a per-day send log for the daily digest cron
-- (src/app/api/cron/digest/route.ts). Both are only ever written by the
-- service-role admin client (src/lib/supabase/admin.ts) or by the
-- authenticated user themselves — RLS still applies for the latter.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_all_own" on public.push_subscriptions
  for all using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

-- One row per user per calendar day a digest was actually sent — the
-- unique constraint is the idempotency guard: a retried or overlapping
-- cron run can't double-send, since the second insert attempt just fails.
create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, sent_date)
);

alter table public.briefings enable row level security;

create policy "briefings_select_own" on public.briefings
  for select using (auth.uid () = user_id);
