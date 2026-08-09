-- In-app suggestions, bug reports and help requests.
--
-- Feedback that lands nowhere readable is worse than no feedback box at
-- all (it silently teaches users their input is ignored), so this is a
-- real table an admin can read — not an email hand-off or a fire-and-
-- forget log line.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('suggestion', 'bug', 'help')),
  message text not null,
  -- Which page it was sent from, and the browser — a bug report without
  -- either is usually unactionable, and asking the user to describe their
  -- setup is friction that suppresses reports.
  page_path text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_feedback_created on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- Users can file feedback and see their own submissions back, but never
-- anyone else's — feedback often contains personal context.
create policy "feedback_insert_own" on public.feedback for insert
  with check (auth.uid() = user_id);

create policy "feedback_select_own" on public.feedback for select
  using (auth.uid() = user_id);

-- Admins read everything, which is the entire point of collecting it.
-- Mirrors the existing admin gate used by system_prompts.
create policy "feedback_select_admin" on public.feedback for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Explicit grants, per this project's rule: RLS alone is not enough, the
-- role needs real table privileges or every query fails with "permission
-- denied" before RLS is ever evaluated. No update/delete for
-- authenticated on purpose — feedback is an append-only record.
grant select, insert on public.feedback to authenticated;
grant all on public.feedback to service_role;
