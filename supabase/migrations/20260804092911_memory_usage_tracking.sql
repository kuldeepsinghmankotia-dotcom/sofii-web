-- Pragmatic subset of memory evolution: track real recall usage so the
-- Memories page can show which memories are actually load-bearing versus
-- dead weight ("explainable retrieval"), instead of leaving that entirely
-- invisible. No automated archival/deletion — that stays a manual, explicit
-- user action via the existing delete button.
alter table public.memories add column use_count int not null default 0;
alter table public.memories add column last_used_at timestamptz;

-- Atomic per-row increment via a single UPDATE, avoiding the read-then-write
-- race a fetch-then-.update() from the app would have if two chat requests
-- both recalled the same memory close together.
create function public.increment_memory_usage(memory_ids uuid[])
returns void
language sql
as $$
  update public.memories
  set use_count = use_count + 1, last_used_at = now()
  where id = any(memory_ids) and user_id = auth.uid();
$$;

grant execute on function public.increment_memory_usage (uuid[]) to authenticated;
grant execute on function public.increment_memory_usage (uuid[]) to service_role;
