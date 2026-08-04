const CHUNK_SIZE = 1500
const CHUNK_OVERLAP = 200

/**
 * Splits text into overlapping fixed-size chunks, breaking on paragraph
 * boundaries where possible so a chunk doesn't split mid-sentence more than
 * necessary. Simple by design — good enough for keyword/semantic recall at
 * this scale, not a document-structure-aware chunker.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.length + paragraph.length + 2 > CHUNK_SIZE) {
      chunks.push(current)
      const overlapStart = Math.max(0, current.length - CHUNK_OVERLAP)
      current = current.slice(overlapStart)
    }
    current = current.length > 0 ? `${current}\n\n${paragraph}` : paragraph

    // A single paragraph longer than CHUNK_SIZE still needs splitting on its own.
    while (current.length > CHUNK_SIZE) {
      chunks.push(current.slice(0, CHUNK_SIZE))
      current = current.slice(CHUNK_SIZE - CHUNK_OVERLAP)
    }
  }

  if (current.trim().length > 0) chunks.push(current)

  return chunks
}
