-- Tracks async ingestion jobs kicked off by src/app/api/ingest/route.ts and
-- processed by the Python service (services/ingestion-agent/). The
-- Next.js proxy inserts the initial 'pending' row as the authenticated
-- user (RLS-scoped); the Python service moves it through
-- processing -> done/failed using the service-role key, which bypasses RLS
-- (same trust model as push_subscriptions/briefings in
-- 20260807161425_push_and_briefings.sql).
create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  filename text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ingestion_jobs_user on public.ingestion_jobs (user_id, created_at desc);

alter table public.ingestion_jobs enable row level security;

create policy "ingestion_jobs_all_own" on public.ingestion_jobs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ingestion_jobs to authenticated;
grant all on public.ingestion_jobs to service_role;
