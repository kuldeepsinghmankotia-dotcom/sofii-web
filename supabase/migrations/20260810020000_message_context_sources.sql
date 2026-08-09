-- Reply provenance: what actually produced each assistant answer.
--
-- Sofii pulls from four independent context sources before answering
-- (long-term memories, uploaded documents, other conversations via
-- cross-conversation recall, and live tool calls), but the user only ever
-- saw the finished reply — with no way to tell whether "your budget was
-- $14,500" came from a real stored fact, a document, something said three
-- weeks ago, or was simply made up.
--
-- Stored on the message rather than streamed as a response header so it
-- survives a page reload and stays attached to the message permanently,
-- and so a header size limit can never truncate it.
--
-- jsonb rather than four join tables: this is display-only provenance
-- read as a whole blob alongside its message, never queried across rows,
-- so normalising it would add joins and migrations for no benefit —
-- same reasoning as document_chunks.metadata.
alter table public.messages
  add column context_sources jsonb;
