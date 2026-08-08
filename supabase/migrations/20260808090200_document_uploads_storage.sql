-- Private bucket (unlike chat-images, which is deliberately public) since
-- uploaded documents are typically more sensitive than chat images and
-- there's no need for a public CDN-style URL here: the only readers are
-- the owning user (via RLS) and the Python ingestion service (via the
-- service-role key, which bypasses storage RLS the same way it bypasses
-- table RLS).
insert into storage.buckets (id, name, public)
values ('document-uploads', 'document-uploads', false)
on conflict (id) do nothing;

create policy "document_uploads_insert_own" on storage.objects for insert
  with check (bucket_id = 'document-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "document_uploads_select_own" on storage.objects for select
  using (bucket_id = 'document-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "document_uploads_delete_own" on storage.objects for delete
  using (bucket_id = 'document-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
