-- Distinguishes memories the user explicitly asked Sofii to save from ones
-- Sofii noticed on its own in ordinary conversation (see
-- src/lib/memory/extract.ts) — surfaced in the Memories page as an
-- "Auto-detected" badge so auto-saved facts stay visible/deletable rather
-- than silently accumulating.
alter table public.memories
  add column source text not null default 'manual' check (source in ('manual', 'auto'));
