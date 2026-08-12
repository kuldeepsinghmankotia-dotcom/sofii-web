import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createDocument, deleteDocument, insertChunks } from '@/lib/db/documents'
import { extractPdfText } from '@/lib/pdf/extract'
import { chunkText } from '@/lib/pdf/chunk'
import { embedTexts } from '@/lib/gemini/embeddings'
import { isSarvamConfigured } from '@/lib/sarvam/client'
import { digitiseDocument } from '@/lib/sarvam/vision'

// What Sarvam Vision accepts as an image.
const OCR_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg'])

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

  // Images are accepted here now, not only PDFs. Sarvam Vision reads them,
  // which matters disproportionately in India: the common case is a photo of
  // a form, a bill or a handwritten note, and routing those through the
  // Mac-hosted service made them depend on that machine being awake.
  const isPdf = file.type === 'application/pdf'
  const isImage = OCR_IMAGE_TYPES.has(file.type)

  if (!isPdf && !isImage) {
    return new Response('Only PDF and image files are supported here', { status: 400 })
  }

  if (isImage && !isSarvamConfigured()) {
    return new Response('Image documents are not available yet', { status: 503 })
  }

  if (file.size > MAX_FILE_BYTES) {
    return new Response('File too large (max 4MB)', { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let text: string

  if (isImage) {
    const result = await digitiseDocument(await file.arrayBuffer(), file.name, file.type)
    if (!result) {
      return new Response("Couldn't read that image — try a clearer photo.", { status: 400 })
    }
    text = result.markdown
  } else {
    try {
      text = await extractPdfText(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(`Could not read PDF: ${message}`, { status: 400 })
    }

    // A PDF that yields nothing is almost always a scan — pages of images
    // with no text layer, which is exactly what OCR is for. Previously this
    // was a dead end telling the user their own document was empty.
    if (!text.trim() && isSarvamConfigured()) {
      const result = await digitiseDocument(await file.arrayBuffer(), file.name, file.type)
      if (result) text = result.markdown
    }
  }

  const chunks = chunkText(text)
  if (chunks.length === 0) {
    return new Response(
      isImage
        ? "Couldn't find any text in that image."
        : 'No readable text found in this PDF, even after trying to read it as a scan.',
      { status: 400 }
    )
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
