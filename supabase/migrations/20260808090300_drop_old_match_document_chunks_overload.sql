-- CREATE OR REPLACE in 20260808090000_multi_modal_documents.sql didn't
-- actually replace the original 2-arg match_document_chunks — Postgres
-- treats a changed argument-type list as a distinct function, so it
-- created a second overload instead, leaving the old one (without
-- modality filtering) still resolvable. Drop it so there's exactly one
-- definition; the 3-arg version's default for modality_filter already
-- covers every existing 2-arg call site.
drop function if exists public.match_document_chunks (vector, int);
