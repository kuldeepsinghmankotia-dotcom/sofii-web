-- One row per user per provider (only 'google' for now). Tokens are stored
-- in plain columns rather than via pgcrypto/Vault — acceptable at this
-- stage since RLS already confines every row to its owner and the table is
-- never exposed outside the request-scoped server client, but worth
-- upgrading to encrypted-at-rest storage before this handles many users.
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.calendar_connections enable row level security;

create policy "calendar_connections_all_own" on public.calendar_connections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.calendar_connections to authenticated;
grant all on public.calendar_connections to service_role;
