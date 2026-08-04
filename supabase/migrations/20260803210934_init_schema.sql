-- Sofii web pivot — Phase 0 schema
-- Multi-tenant: every user-owned table has user_id, isolated via Row Level
-- Security rather than app-layer filtering.

create extension if not exists vector;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_conversations_user on public.conversations (user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade, -- denormalized, cheap RLS
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on public.messages (conversation_id, created_at);

-- Reserved now (empty/unused until Phase 1) so Phase 1 needs no migration for these:
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  embedding vector (384), -- nullable; keyword-overlap recall used initially, see CLAUDE.md notes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  scheduled_at timestamptz not null,
  status text not null check (status in ('pending', 'fired', 'cancelled')) default 'pending',
  created_at timestamptz not null default now()
);

create index idx_reminders_user_status on public.reminders (user_id, status, scheduled_at);

-- Auto-create a profile row whenever a new auth.users row is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security: every table scoped to auth.uid().
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.reminders enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid () = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid () = id);

create policy "conversations_select_own" on public.conversations
  for select using (auth.uid () = user_id);

create policy "conversations_insert_own" on public.conversations
  for insert
  with check (auth.uid () = user_id);

create policy "conversations_update_own" on public.conversations
  for update using (auth.uid () = user_id);

create policy "conversations_delete_own" on public.conversations
  for delete using (auth.uid () = user_id);

create policy "messages_select_own" on public.messages
  for select using (auth.uid () = user_id);

create policy "messages_insert_own" on public.messages
  for insert
  with check (auth.uid () = user_id);

create policy "messages_delete_own" on public.messages
  for delete using (auth.uid () = user_id);

create policy "memories_all_own" on public.memories
  for all using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

create policy "reminders_all_own" on public.reminders
  for all using (auth.uid () = user_id)
  with check (auth.uid () = user_id);
