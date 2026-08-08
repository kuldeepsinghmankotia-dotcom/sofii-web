-- Phase 8 (query-time agent layer): the existing match_document_chunks
-- filters by auth.uid(), which is null for the Python ingestion/query
-- service's service-role calls (it has no Supabase session/JWT) - a
-- service-role call to match_document_chunks would silently return zero
-- rows for every query, not an error. This variant takes the target user
-- explicitly and is granted ONLY to service_role: the Next.js /api/query
-- proxy is what verifies the caller actually owns that user_id (via a real
-- authenticated Supabase session) before ever reaching the Python service,
-- same trust model already used for /api/ingest.
create function public.match_document_chunks_for_service(
  query_embedding vector (768),
  target_user_id uuid,
  match_count int default 5,
  modality_filter text default null
)
returns table (id uuid, document_id uuid, content text, similarity float)
language sql
stable
as $$
  select id, document_id, content, 1 - (embedding <=> query_embedding) as similarity
  from public.document_chunks
  where user_id = target_user_id
    and (modality_filter is null or modality = modality_filter)
  order by embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_document_chunks_for_service (vector, uuid, int, text) to service_role;
