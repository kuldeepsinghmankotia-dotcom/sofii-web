import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export interface DocumentSummary {
  id: string
  filename: string
  created_at: string
}

const DOCUMENT_UPLOADS_BUCKET = 'document-uploads'

export interface DocumentChunkMatch {
  id: string
  document_id: string
  content: string
  similarity: number
}

// Cheap existence check so /api/chat can skip the embedding API round-trip
// entirely for the common case of a user who has never uploaded a document.
export async function hasAnyDocuments(supabase: Client): Promise<boolean> {
  const { count, error } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })

  if (error) throw error
  return (count ?? 0) > 0
}

export async function getDocument(
  supabase: Client,
  id: string
): Promise<DocumentSummary | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, filename, created_at')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data
}

// Populated only for image documents that went through the OCR ensemble
// (Phase 6) — true when Gemini and Ollama's transcriptions disagreed
// enough that cross_validate() didn't silently pick one.
export async function getDocumentOcrFlag(supabase: Client, documentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('document_chunks')
    .select('metadata')
    .eq('document_id', documentId)
    .order('chunk_index')
    .limit(1)

  if (error) throw error
  const metadata = data[0]?.metadata as { ocr_flagged_for_review?: boolean } | null
  return metadata?.ocr_flagged_for_review === true
}

export async function listDocuments(supabase: Client): Promise<DocumentSummary[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, filename, created_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createDocument(
  supabase: Client,
  params: { userId: string; filename: string }
): Promise<DocumentSummary> {
  const { data, error } = await supabase
    .from('documents')
    .insert({ user_id: params.userId, filename: params.filename })
    .select('id, filename, created_at')
    .single()

  if (error) throw error
  return data
}

// Storage cleanup runs before the row delete (not after, and not
// best-effort-skippable) so the storage_path is still readable — deleting
// the row first would lose the only pointer back to the uploaded file.
// PDF documents (source_type='pdf') never touch Storage at all (see
// api/documents/upload/route.ts), so storage_path is null for them and
// this is a no-op.
export async function deleteDocument(supabase: Client, id: string): Promise<void> {
  const { data: document } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle()

  if (document?.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(DOCUMENT_UPLOADS_BUCKET)
      .remove([document.storage_path])
    if (storageError) console.error('Failed to delete document Storage object:', storageError)
  }

  const { error } = await supabase.from('documents').delete().eq('id', id)
  if (error) throw error
}

export async function insertChunks(
  supabase: Client,
  params: {
    documentId: string
    userId: string
    chunks: { content: string; embedding: number[] }[]
  }
): Promise<void> {
  const rows = params.chunks.map((chunk, index) => ({
    document_id: params.documentId,
    user_id: params.userId,
    chunk_index: index,
    content: chunk.content,
    embedding: JSON.stringify(chunk.embedding)
  }))

  const { error } = await supabase.from('document_chunks').insert(rows)
  if (error) throw error
}

// queryText enables the hybrid keyword side of retrieval (Postgres
// full-text search, unioned with the vector top-K inside the RPC) —
// optional and defaults to vector-only, since not every caller has (or
// needs) the original query string on hand.
export async function matchDocumentChunks(
  supabase: Client,
  queryEmbedding: number[],
  matchCount = 5,
  queryText = ''
): Promise<DocumentChunkMatch[]> {
  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount,
    query_text: queryText
  })

  if (error) throw error
  return data
}
