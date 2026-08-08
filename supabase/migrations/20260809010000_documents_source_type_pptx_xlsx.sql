-- The Python ingestion graph now emits detected_format 'pptx'/'xlsx' (see
-- extract_pptx.py/extract_xlsx.py, added alongside this migration), but
-- persist_node writes that value straight into documents.source_type,
-- which the original check constraint never allowed for these two -
-- found live when a real xlsx upload's persist_node insert failed with
-- "violates check constraint documents_source_type_check".
alter table public.documents
  drop constraint documents_source_type_check;

alter table public.documents
  add constraint documents_source_type_check
    check (source_type in ('pdf', 'txt', 'html', 'csv', 'docx', 'pptx', 'xlsx', 'image'));
