// Groq doesn't offer an embeddings endpoint, so document/memory-style
// semantic search needs a separate provider. Picked after Brave Search
// turned out to require payment details despite advertising a free tier —
// Gemini's embedding API is free with no credit card. Model name verified
// live against the API: `text-embedding-004` (expected from prior
// knowledge) is gone, replaced by `gemini-embedding-001`, which defaults to
// 3072 dimensions but supports truncating via `outputDimensionality` (an
// MRL-style truncation, not a separate model) — 768 is requested to match
// document_chunks.embedding's column width and keep the HNSW index cheap.
const EMBEDDING_MODEL = 'models/gemini-embedding-001'
const EMBEDDING_DIMENSIONS = 768

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return key
}

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL}:embedContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS
      })
    }
  )

  if (!response.ok) {
    throw new Error(`Gemini embedContent failed with status ${response.status}`)
  }

  const data = (await response.json()) as { embedding: { values: number[] } }
  return data.embedding.values
}

// Gemini's batchEmbedContents caps at 100 requests per call.
const BATCH_SIZE = 100

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL}:batchEmbedContents`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': getApiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: EMBEDDING_MODEL,
            content: { parts: [{ text }] },
            outputDimensionality: EMBEDDING_DIMENSIONS
          }))
        })
      }
    )

    if (!response.ok) {
      throw new Error(`Gemini batchEmbedContents failed with status ${response.status}`)
    }

    const data = (await response.json()) as { embeddings: { values: number[] }[] }
    results.push(...data.embeddings.map((e) => e.values))
  }

  return results
}
