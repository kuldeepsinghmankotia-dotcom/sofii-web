import type { Memory } from '@/lib/db/memories'

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'and',
  'or',
  'in',
  'on',
  'at',
  'for',
  'with',
  'my',
  'me',
  'i',
  'you',
  'your',
  'it',
  'that',
  'this'
])

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word))

  return new Set(words)
}

/**
 * Pure, dependency-free keyword-overlap relevance scoring for memory recall.
 * Deliberately simple (no embeddings/vector search) so it needs no network
 * calls or ML runtime — fine at current scale, and can be swapped for a
 * pgvector-based semantic ranker later behind this same signature (the
 * `embedding` column already exists on public.memories, reserved unused).
 */
export function rankMemoriesByRelevance(memories: Memory[], query: string, limit: number): Memory[] {
  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return []

  const scored = memories
    .map((memory) => {
      const memoryTokens = tokenize(memory.content)
      let score = 0
      for (const token of queryTokens) {
        if (memoryTokens.has(token)) score += 1
      }
      return { memory, score }
    })
    .filter((entry) => entry.score > 0)

  scored.sort(
    (a, b) => b.score - a.score || Date.parse(b.memory.updated_at) - Date.parse(a.memory.updated_at)
  )

  return scored.slice(0, limit).map((entry) => entry.memory)
}
