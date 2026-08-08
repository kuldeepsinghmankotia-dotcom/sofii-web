-- Tracks the document-uploads Storage object each Python-ingested
-- document/job came from, so it can actually be cleaned up on delete or
-- on failure - previously storage_path was passed to the Python service
-- but never persisted anywhere, so uploaded files were orphaned forever
-- (no DB row ever pointed back at them, successful or not). Null for PDF
-- rows (typescript path never touches Storage - see
-- src/app/api/documents/upload/route.ts) and for any document ingested
-- before this migration.
alter table public.documents
  add column storage_path text;

alter table public.ingestion_jobs
  add column storage_path text;
