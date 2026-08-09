-- Cross-conversation semantic recall.
--
-- Until now Sofii could search a user's *documents* semantically
-- (document_chunks + match_document_chunks) and remember durable facts
-- (memories), but every past *conversation* was a sealed box: asking
-- "what did we decide about that watch last week?" in a new chat had no
-- way to find the answer, even though it was sitting in the database.
-- This embeds messages themselves so past conversations become
-- first-class searchable context, the same way documents already are.
--
-- Same 768-dim gemini-embedding-001 vectors and HNSW/cosine setup as
-- document_chunks, so there's one embedding model across the whole app
-- and no second dimension to keep in sync.
alter table public.messages
  add column embedding vector (768);

-- Partial index: only rows that actually have an embedding. Most of the
-- table (short "ok"/"thanks" turns, and anything not yet backfilled) is
-- deliberately never embedded — see lib/db/message-embeddings.ts's
-- MIN_EMBEDDABLE_CHARS — so indexing the whole column would bloat the
-- index with nothing to find.
create index idx_messages_embedding on public.messages
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- Finds semantically similar messages from the user's OTHER conversations.
--
-- exclude_conversation_id is the point of the whole function: the current
-- conversation's own history is already passed to the model in full (see
-- api/chat/route.ts), so matching against it would just burn context
-- re-injecting text the model can already see. This is specifically for
-- surfacing what was said *elsewhere*.
--
-- Runs as the calling role (not security definer), so messages' own RLS
-- policy confines it to the caller's rows even before the explicit
-- auth.uid() filter below — kept anyway as defense-in-depth and to make
-- the intent obvious from the body, matching match_document_chunks.
create function public.match_messages(
  query_embedding vector (768),
  exclude_conversation_id uuid,
  match_count int default 5,
  similarity_threshold float default 0.5
)
returns table (
  id uuid,
  conversation_id uuid,
  conversation_title text,
  role text,
  content text,
  created_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    m.id,
    m.conversation_id,
    c.title as conversation_title,
    m.role,
    m.content,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.user_id = auth.uid()
    and m.embedding is not null
    and m.conversation_id is distinct from exclude_conversation_id
    and 1 - (m.embedding <=> query_embedding) >= similarity_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- Explicit grants, per this project's hard-learned rule: RLS alone is not
-- enough, both roles need real privileges or every call fails with
-- "permission denied" before RLS is ever evaluated. Deliberately granted
-- to authenticated (unlike the *_for_service functions): this one is
-- self-scoped by auth.uid() and takes no arbitrary user id, so a user
-- calling it directly can only ever reach their own messages.
grant execute on function public.match_messages (vector, uuid, int, float) to authenticated;
grant execute on function public.match_messages (vector, uuid, int, float) to service_role;
