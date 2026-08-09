import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createDocument, insertChunks, matchDocumentChunks } from '@/lib/db/documents'
import { listMemories } from '@/lib/db/memories'
import { recallRelatedMessagesByText } from '@/lib/db/message-embeddings'
import { rankMemoriesByRelevance } from '@/lib/memory/ranking'
import { embedText, embedTexts } from '@/lib/gemini/embeddings'
import { chunkText } from '@/lib/pdf/chunk'

type Client = SupabaseClient<Database>

/**
 * One semantic search across everything Sofii holds for a user —
 * documents, past conversations, and stored memories — instead of three
 * separate tools the model has to pick between (and often picks wrong).
 *
 * Each source is independently best-effort: one failing (say a Gemini
 * embedding hiccup) still returns whatever the others found, rather than
 * turning a partial answer into no answer.
 */
export async function searchEverything(
  supabase: Client,
  query: string,
  excludeConversationId: string
): Promise<string> {
  const sections: string[] = []

  const [documents, conversations, memories] = await Promise.all([
    (async () => {
      try {
        const embedding = await embedText(query)
        return await matchDocumentChunks(supabase, embedding, 4, query)
      } catch (error) {
        console.error('searchEverything document search failed:', error)
        return []
      }
    })(),
    recallRelatedMessagesByText(supabase, query, excludeConversationId, 4),
    (async () => {
      try {
        return rankMemoriesByRelevance(await listMemories(supabase), query, 4)
      } catch (error) {
        console.error('searchEverything memory search failed:', error)
        return []
      }
    })()
  ])

  if (documents.length > 0) {
    sections.push(
      `From the user's documents:\n${documents.map((d) => `- ${d.content.slice(0, 500)}`).join('\n')}`
    )
  }

  if (conversations.length > 0) {
    sections.push(
      `From earlier conversations:\n${conversations
        .map((c) => {
          const when = new Date(c.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          })
          return `- [${when}, "${c.conversation_title}"] ${c.role === 'user' ? 'User' : 'You'}: ${c.content.slice(0, 500)}`
        })
        .join('\n')}`
    )
  }

  if (memories.length > 0) {
    sections.push(`Stored facts about the user:\n${memories.map((m) => `- ${m.content}`).join('\n')}`)
  }

  if (sections.length === 0) {
    return 'Nothing found in the user\'s documents, past conversations, or stored memories about that. Say so plainly rather than guessing.'
  }

  return sections.join('\n\n')
}

/**
 * Saves text from a conversation as a real, permanently searchable
 * document — the same pipeline an uploaded file goes through (chunk →
 * embed → persist), so a saved note is findable later by
 * search_everything and by ordinary chat document recall.
 *
 * Deliberately reuses the existing TypeScript PDF path's chunker and
 * embedding model rather than routing through the Python ingestion
 * service: there's no file to fetch, parse or OCR here, so the network
 * round-trip and its Mac-availability dependency would buy nothing.
 */
export async function saveNoteAsDocument(
  supabase: Client,
  userId: string,
  title: string,
  content: string
): Promise<{ filename: string; chunkCount: number }> {
  const chunks = chunkText(content)
  if (chunks.length === 0) throw new Error('Note is empty')

  // Suffixed so it's obvious in the Documents list that this came from a
  // conversation rather than an upload.
  const filename = `${title.replace(/[^\w\s.-]/g, '').trim().slice(0, 80) || 'Note'} (note)`
  const document = await createDocument(supabase, { userId, filename })

  try {
    const embeddings = await embedTexts(chunks)
    await insertChunks(supabase, {
      documentId: document.id,
      userId,
      chunks: chunks.map((c, i) => ({ content: c, embedding: embeddings[i] }))
    })
  } catch (error) {
    // Same guard the PDF upload route uses: never leave an empty,
    // unsearchable document behind if embedding fails partway.
    await supabase.from('documents').delete().eq('id', document.id)
    throw error
  }

  return { filename, chunkCount: chunks.length }
}
