-- Extends the existing PDF-only documents/document_chunks schema (see
-- 20260804081104_documents_schema.sql) to support the new Python ingestion
-- pipeline's additional formats without touching the existing TS PDF path.
-- Existing rows get sensible defaults so this is a behavioral no-op for
-- them (source_type='pdf', ingested_by='typescript', modality='prose').

alter table public.documents
  add column source_type text not null default 'pdf'
    check (source_type in ('pdf', 'txt', 'html', 'csv', 'docx', 'image')),
  add column ingested_by text not null default 'typescript'
    check (ingested_by in ('typescript', 'python')),
  add column metadata jsonb not null default '{}'::jsonb;

alter table public.document_chunks
  add column modality text not null default 'prose'
    check (modality in ('prose', 'tabular')),
  add column metadata jsonb not null default '{}'::jsonb;

-- Adds an optional trailing modality_filter param (default null = no
-- filtering) so the existing TS call site (matchDocumentChunks in
-- src/lib/db/documents.ts, which only ever passes query_embedding and
-- match_count) keeps working unmodified.
create or replace function public.match_document_chunks(
  query_embedding vector (768),
  match_count int default 5,
  modality_filter text default null
)
returns table (id uuid, document_id uuid, content text, similarity float)
language sql
stable
as $$
  select id, document_id, content, 1 - (embedding <=> query_embedding) as similarity
  from public.document_chunks
  where user_id = auth.uid()
    and (modality_filter is null or modality = modality_filter)
  order by embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_document_chunks (vector, int, text) to authenticated;
grant execute on function public.match_document_chunks (vector, int, text) to service_role;
