import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createDocument, deleteDocument, insertChunks } from '@/lib/db/documents'
import { extractPdfText } from '@/lib/pdf/extract'
import { chunkText } from '@/lib/pdf/chunk'
import { embedTexts } from '@/lib/gemini/embeddings'

// Vercel Serverless Functions cap request bodies at ~4.5MB regardless of
// what this route allows, so this stays safely under that platform limit
// rather than accepting uploads that would fail before reaching this code.
const MAX_FILE_BYTES = 4 * 1024 * 1024

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return new Response('Missing file', { status: 400 })
  }

  if (file.type !== 'application/pdf') {
    return new Response('Only PDF files are supported', { status: 400 })
  }

  if (file.size > MAX_FILE_BYTES) {
    return new Response('File too large (max 10MB)', { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let text: string
  try {
    text = await extractPdfText(buffer)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`Could not read PDF: ${message}`, { status: 400 })
  }

  const chunks = chunkText(text)
  if (chunks.length === 0) {
    return new Response('No extractable text found in this PDF', { status: 400 })
  }

  const document = await createDocument(supabase, { userId: user.id, filename: file.name })

  try {
    const embeddings = await embedTexts(chunks)
    await insertChunks(supabase, {
      documentId: document.id,
      userId: user.id,
      chunks: chunks.map((content, i) => ({ content, embedding: embeddings[i] }))
    })
  } catch (error) {
    // Don't leave an empty, unsearchable document behind if embedding fails partway.
    await deleteDocument(supabase, document.id)
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`Failed to process document: ${message}`, { status: 500 })
  }

  return Response.json({ document, chunkCount: chunks.length })
}
