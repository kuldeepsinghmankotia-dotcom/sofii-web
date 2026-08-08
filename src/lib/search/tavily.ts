// Real web search (not just instant-answer facts) — picked over
// Google Custom Search (needs a GCP project) and Bing (retired for new
// customers): Tavily is built specifically for AI agents, has a genuine
// free tier (1000 searches/month) with no card required to sign up. Get
// a key at https://app.tavily.com and set TAVILY_API_KEY.
interface TavilyResult {
  title: string
  url: string
  content: string
}

interface TavilyResponse {
  results?: TavilyResult[]
  answer?: string
}

const MAX_RESULTS = 5

function getApiKey(): string {
  const key = process.env.TAVILY_API_KEY
  if (!key) throw new Error('TAVILY_API_KEY is not set')
  return key
}

/**
 * Real web search, returning a plain-text summary of multiple results
 * (title, snippet, source URL) for feeding back to the model as a tool
 * result — same contract as the previous DuckDuckGo-backed searchWeb:
 * throws on network/HTTP failure, returns an explicit "no result" message
 * (never silence) when nothing comes back.
 */
export async function searchWeb(query: string): Promise<string> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: getApiKey(),
      query,
      max_results: MAX_RESULTS,
      include_answer: true
    })
  })

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`)
  }

  const data = (await response.json()) as TavilyResponse
  const lines: string[] = []

  if (data.answer) lines.push(data.answer, '')

  const results = data.results ?? []
  if (results.length > 0) {
    lines.push('Sources:')
    for (const result of results) {
      lines.push(`- ${result.title}: ${result.content} (${result.url})`)
    }
  }

  if (lines.length === 0) {
    return `No web results found for "${query}". Tell the user honestly rather than guessing.`
  }

  return lines.join('\n')
}
