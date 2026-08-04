alter table public.messages add column image_url text;

-- Public-read bucket: images are served via Supabase's public CDN-style URL
-- (bypasses RLS entirely, same trade-off as everything else stored in
-- plain form in this app so far) — acceptable for a personal app at this
-- stage since URLs are unguessable UUIDs, not because the content is
-- non-sensitive. INSERT/DELETE stay RLS-scoped so one user can't write into
-- or remove another user's folder.
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

create policy "chat_images_insert_own" on storage.objects for insert
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "chat_images_delete_own" on storage.objects for delete
  using (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);
