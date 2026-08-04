create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  filename text not null,
  created_at timestamptz not null default now()
);

create index idx_documents_user on public.documents (user_id, created_at desc);

-- Gemini's text-embedding-004 outputs 768 dimensions by default.
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade, -- denormalized, same reasoning as messages.user_id: cheap RLS
  chunk_index int not null,
  content text not null,
  embedding vector (768),
  created_at timestamptz not null default now()
);

create index idx_document_chunks_document on public.document_chunks (document_id, chunk_index);
create index idx_document_chunks_embedding on public.document_chunks using hnsw (embedding vector_cosine_ops);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

create policy "documents_all_own" on public.documents for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "document_chunks_all_own" on public.document_chunks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Runs as the calling role (not security definer), so RLS on
-- document_chunks already confines it to the caller's own rows even without
-- the explicit `where user_id = auth.uid()` below — kept anyway as
-- defense-in-depth and to make the intent obvious from the function body.
create function public.match_document_chunks(
  query_embedding vector (768),
  match_count int default 5
)
returns table (id uuid, document_id uuid, content text, similarity float)
language sql
stable
as $$
  select id, document_id, content, 1 - (embedding <=> query_embedding) as similarity
  from public.document_chunks
  where user_id = auth.uid()
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Explicit grants, learned the hard way in an earlier migration: RLS alone
-- is not enough, both authenticated and service_role need real table
-- privileges or every query fails with "permission denied" before RLS is
-- ever evaluated.
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_chunks to authenticated;
grant execute on function public.match_document_chunks (vector, int) to authenticated;

grant all on public.documents to service_role;
grant all on public.document_chunks to service_role;
grant execute on function public.match_document_chunks (vector, int) to service_role;
