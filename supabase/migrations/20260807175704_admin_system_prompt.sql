-- Role infrastructure (didn't exist before) + an admin-editable system
-- prompt table, replacing the hardcoded SYSTEM_PROMPT constant in
-- src/lib/groq/client.ts. See src/lib/db/system-prompt.ts for the read
-- path and src/app/api/admin/system-prompt/route.ts for the write path.

alter table public.profiles
  add column role text not null default 'user' check (role in ('user', 'admin'));

-- profiles_update_own (existing policy) is row-level, not column-level —
-- without this, any authenticated user could self-promote via a direct
-- `update profiles set role = 'admin' where id = auth.uid()` client call.
-- auth.role() reads the request's JWT claim ('authenticated' for a normal
-- user session, 'service_role' for the admin API's service-role client);
-- it's NULL outside a PostgREST request (e.g. this migration's own
-- bootstrap UPDATE below, run via direct connection), which is exactly
-- the other case this must not block.
create function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.role() <> 'service_role' then
    new.role := old.role;
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();

-- One-time bootstrap: there is no admin yet, and an admin UI can't grant
-- the first admin. Confirmed explicitly with the user before writing this.
update public.profiles set role = 'admin' where email = 'amit21aim@gmail.com';

create table public.system_prompts (
  id uuid primary key default gen_random_uuid(),
  key text not null unique default 'default',
  content text not null,
  is_active boolean not null default true,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seeded with the current hardcoded prompt so shipping this table is
-- behaviorally a no-op on day one — see SYSTEM_PROMPT in
-- src/lib/groq/client.ts, which this seed value is copied from verbatim.
insert into public.system_prompts (content) values (
  'You are SOFII, a friendly, intelligent AI assistant. Format replies in markdown like Copilot/ChatGPT: short paragraphs, bullet or numbered lists for multiple items or steps, **bold** for key terms, and fenced code blocks for any code, commands, or file contents. Use headings only for genuinely long, multi-section answers. Default to brief, scannable answers over long prose — expand only when the question actually calls for detail.'
);

alter table public.system_prompts enable row level security;

-- Every signed-in user's chat reads the active prompt (via the normal
-- RLS-scoped client, see getActiveSystemPrompt) — read access isn't
-- admin-gated, only writes are.
create policy "system_prompts_select_all" on public.system_prompts
  for select using (true);

create policy "system_prompts_admin_write" on public.system_prompts
  for all using (
    exists (select 1 from public.profiles where id = auth.uid () and role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid () and role = 'admin')
  );

grant select, insert, update, delete on public.system_prompts to authenticated;
grant all on public.system_prompts to service_role;
