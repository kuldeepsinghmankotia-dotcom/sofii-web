-- Phase 7 (long-term memory bridge): facts extracted from an ingested
-- document are a genuinely different provenance from 'auto' (noticed in
-- ordinary chat, see src/lib/memory/extract.ts) — surfaced as its own
-- badge in the Memories UI rather than lumped in with chat-detected facts.
alter table public.memories drop constraint memories_source_check;
alter table public.memories
  add constraint memories_source_check check (source in ('manual', 'auto', 'document'));
