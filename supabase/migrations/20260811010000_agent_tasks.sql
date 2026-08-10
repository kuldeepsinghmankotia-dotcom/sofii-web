-- Multi-step tasks Sofii carries out on its own.
--
-- The chat route already calls tools, but only inside a single turn: it can
-- take four rounds and must finish while the user waits. That is enough for
-- "what's the weather", and not enough for "research three suppliers and
-- summarise them", which needs a plan, several minutes, and the ability to
-- survive the request that started it.
--
-- Making the plan a row rather than a variable is what buys all three. The
-- work can stop and resume, the user can watch it progress and see exactly
-- what was decided before anything ran, and a crash mid-way loses one step
-- instead of everything.

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The conversation it was launched from, so the result can be reported
  -- back where the user asked. Nullable: a task outlives its conversation.
  conversation_id uuid references public.conversations (id) on delete set null,
  goal text not null,
  status text not null default 'planning'
    check (status in ('planning', 'running', 'done', 'failed', 'cancelled')),
  -- Written when the whole task finishes: the answer, not a log.
  summary text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The dashboard query: this user's tasks, newest first.
create index idx_agent_tasks_user on public.agent_tasks (user_id, created_at desc);

-- Finding work that stalled. Partial, because only unfinished tasks are ever
-- swept and they are a small minority.
create index idx_agent_tasks_active on public.agent_tasks (updated_at)
  where status in ('planning', 'running');

alter table public.agent_tasks enable row level security;

create policy "agent_tasks_select_own" on public.agent_tasks for select
  using (auth.uid() = user_id);

create policy "agent_tasks_insert_own" on public.agent_tasks for insert
  with check (auth.uid() = user_id);

-- Users may cancel their own tasks from the UI; the executor writes
-- everything else via service_role.
create policy "agent_tasks_update_own" on public.agent_tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "agent_tasks_delete_own" on public.agent_tasks for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.agent_tasks to authenticated;
grant all on public.agent_tasks to service_role;

-- One step of a plan.
--
-- Stored individually rather than as a jsonb blob on the task so a single
-- step can be updated as it runs without rewriting the whole plan, and so
-- "what is it doing right now" is a cheap indexed read rather than a parse.
create table public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agent_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Position in the plan, 0-based. Unique per task so a retry cannot
  -- silently duplicate a step.
  step_index int not null,
  title text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  -- What the step produced, fed to later steps as context.
  result text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (task_id, step_index)
);

create index idx_agent_steps_task on public.agent_steps (task_id, step_index);

alter table public.agent_steps enable row level security;

create policy "agent_steps_select_own" on public.agent_steps for select
  using (auth.uid() = user_id);

grant select on public.agent_steps to authenticated;
grant all on public.agent_steps to service_role;

-- Steps are written only by the executor (service_role), so authenticated
-- gets read access alone. A user editing a step mid-run would corrupt the
-- context later steps depend on.
revoke insert, update, delete on public.agent_steps from authenticated;

-- Keeps agent_tasks.updated_at honest, which the stalled-task sweep relies
-- on. Doing it in a trigger rather than in application code means a write
-- from anywhere - executor, UI, a manual fix - cannot forget.
create or replace function public.touch_agent_task()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agent_tasks_touch
  before update on public.agent_tasks
  for each row execute function public.touch_agent_task();
