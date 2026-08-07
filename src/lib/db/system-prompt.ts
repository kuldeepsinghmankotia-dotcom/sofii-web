import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

// Only used if the system_prompts row is ever missing — shouldn't happen
// in practice (the migration that created the table seeded it with this
// exact string), but a chat request should never hard-fail just because
// that row is momentarily absent.
export const FALLBACK_SYSTEM_PROMPT =
  'You are SOFII, a friendly, intelligent AI assistant. Format replies in markdown like ' +
  'Copilot/ChatGPT: short paragraphs, bullet or numbered lists for multiple items or steps, ' +
  '**bold** for key terms, and fenced code blocks for any code, commands, or file contents. ' +
  'Use headings only for genuinely long, multi-section answers. Default to brief, scannable ' +
  'answers over long prose — expand only when the question actually calls for detail.'

// No caching layer here deliberately — this project's next.config.ts
// doesn't have Cache Components enabled ('use cache' isn't available
// without it, and turning it on project-wide for one small read would be
// a much bigger change than this needs), and a single indexed-row select
// is negligible next to the LLM call that follows it on every chat
// request — not worth the complexity of a cache-invalidation path.
export async function getActiveSystemPrompt(supabase: Client): Promise<string> {
  const { data } = await supabase
    .from('system_prompts')
    .select('content')
    .eq('is_active', true)
    .maybeSingle()

  return data?.content ?? FALLBACK_SYSTEM_PROMPT
}
