-- Hybrid retrieval: pure top-K cosine similarity misses exact-term
-- queries (model numbers, names, specific phrases) that embeddings
-- sometimes under-rank. Adds a Postgres full-text index alongside the
-- existing HNSW vector index, and extends both match_document_chunks
-- variants to union bounded top-N results from each (not a single
-- unbounded scan — each sub-query still uses its own index via its own
-- ORDER BY ... LIMIT, same reasoning the original functions already
-- relied on for the HNSW index).
alter table public.document_chunks
  add column content_tsv tsvector generated always as (to_tsvector('english', content)) stored;

create index idx_document_chunks_content_tsv on public.document_chunks using gin (content_tsv);

-- CREATE OR REPLACE does not replace a function when its parameter list
-- changes (Postgres treats it as a new overload) — learned earlier this
-- project, drop the old signatures explicitly first.
drop function public.match_document_chunks (vector, int, text);
drop function public.match_document_chunks_for_service (vector, uuid, int, text);

create function public.match_document_chunks(
  query_embedding vector (768),
  match_count int default 5,
  modality_filter text default null,
  query_text text default ''
)
returns table (id uuid, document_id uuid, content text, similarity float)
language sql
stable
as $$
  with vector_matches as (
    select id, document_id, content, 1 - (embedding <=> query_embedding) as similarity
    from public.document_chunks
    where user_id = auth.uid()
      and (modality_filter is null or modality = modality_filter)
    order by embedding <=> query_embedding
    limit match_count
  ),
  keyword_matches as (
    select id, document_id, content,
      ts_rank(content_tsv, plainto_tsquery('english', query_text)) as similarity
    from public.document_chunks
    where user_id = auth.uid()
      and (modality_filter is null or modality = modality_filter)
      and query_text <> ''
      and content_tsv @@ plainto_tsquery('english', query_text)
    order by ts_rank(content_tsv, plainto_tsquery('english', query_text)) desc
    limit match_count
  )
  select id, document_id, content, max(similarity) as similarity
  from (select * from vector_matches union all select * from keyword_matches) combined
  group by id, document_id, content
  order by similarity desc
  limit match_count;
$$;

create function public.match_document_chunks_for_service(
  query_embedding vector (768),
  target_user_id uuid,
  match_count int default 5,
  modality_filter text default null,
  query_text text default ''
)
returns table (id uuid, document_id uuid, content text, similarity float)
language sql
stable
as $$
  with vector_matches as (
    select id, document_id, content, 1 - (embedding <=> query_embedding) as similarity
    from public.document_chunks
    where user_id = target_user_id
      and (modality_filter is null or modality = modality_filter)
    order by embedding <=> query_embedding
    limit match_count
  ),
  keyword_matches as (
    select id, document_id, content,
      ts_rank(content_tsv, plainto_tsquery('english', query_text)) as similarity
    from public.document_chunks
    where user_id = target_user_id
      and (modality_filter is null or modality = modality_filter)
      and query_text <> ''
      and content_tsv @@ plainto_tsquery('english', query_text)
    order by ts_rank(content_tsv, plainto_tsquery('english', query_text)) desc
    limit match_count
  )
  select id, document_id, content, max(similarity) as similarity
  from (select * from vector_matches union all select * from keyword_matches) combined
  group by id, document_id, content
  order by similarity desc
  limit match_count;
$$;

-- Every grant/revoke this project's convention requires re-applied in the
-- same migration that (re)creates each function — a fresh CREATE FUNCTION
-- defaults to EXECUTE granted to PUBLIC again, and Supabase Cloud's own
-- ALTER DEFAULT PRIVILEGES rule re-grants to anon/authenticated
-- individually too, both documented the hard way in this project already.
grant execute on function public.match_document_chunks (vector, int, text, text) to authenticated;
grant execute on function public.match_document_chunks (vector, int, text, text) to service_role;

grant execute on function public.match_document_chunks_for_service (vector, uuid, int, text, text) to service_role;
revoke execute on function public.match_document_chunks_for_service (vector, uuid, int, text, text) from public;
revoke execute on function public.match_document_chunks_for_service (vector, uuid, int, text, text) from anon, authenticated;
