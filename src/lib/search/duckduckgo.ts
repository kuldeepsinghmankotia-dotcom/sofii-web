// DuckDuckGo's Instant Answer API: free, no API key, no signup — genuinely
// zero-cost, unlike Brave Search (now requires payment details even on its
// "free" tier). The trade-off: this only returns quick facts/definitions/
// summaries (the same data that powers DDG's knowledge-panel), not organic
// web search results, and returns nothing at all for many general or
// current-events queries. Picked deliberately over scraping DDG's HTML
// search results, which would be more capable but ToS-murky.
interface DuckDuckGoTopic {
  Text?: string
  FirstURL?: string
  Topics?: DuckDuckGoTopic[]
}

interface DuckDuckGoResponse {
  Heading?: string
  AbstractText?: string
  AbstractURL?: string
  Answer?: string
  Definition?: string
  DefinitionURL?: string
  RelatedTopics?: DuckDuckGoTopic[]
}

function flattenTopics(topics: DuckDuckGoTopic[]): string[] {
  const lines: string[] = []
  for (const topic of topics) {
    if (topic.Text && topic.FirstURL) {
      lines.push(`- ${topic.Text} (${topic.FirstURL})`)
    } else if (topic.Topics) {
      lines.push(...flattenTopics(topic.Topics))
    }
  }
  return lines
}

/**
 * Looks up a quick factual answer for a query. Returns a plain-text summary
 * for feeding back to the model as a tool result, or an explicit "no result"
 * message (never silence) when the API has nothing — this API frequently
 * returns nothing for general queries, so the caller must be able to tell
 * the model that plainly rather than it going quiet. Throws on network/HTTP
 * failure, same contract as getWeather.
 */
export async function searchWeb(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}`)
  }

  const data = (await response.json()) as DuckDuckGoResponse
  const lines: string[] = []

  if (data.Answer) lines.push(data.Answer)

  if (data.AbstractText) {
    const heading = data.Heading ? `${data.Heading}: ` : ''
    const source = data.AbstractURL ? ` (${data.AbstractURL})` : ''
    lines.push(`${heading}${data.AbstractText}${source}`)
  }

  if (data.Definition) {
    lines.push(`Definition: ${data.Definition}${data.DefinitionURL ? ` (${data.DefinitionURL})` : ''}`)
  }

  if (lines.length === 0) {
    const related = flattenTopics(data.RelatedTopics ?? []).slice(0, 5)
    if (related.length > 0) {
      lines.push('Related topics:', ...related)
    }
  }

  if (lines.length === 0) {
    return `No instant answer found for "${query}". This tool only covers quick facts/definitions, not general web results — tell the user a full web search isn't available for this yet rather than guessing.`
  }

  return lines.join('\n')
}
