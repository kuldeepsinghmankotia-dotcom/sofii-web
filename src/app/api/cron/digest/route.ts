import { NextRequest } from 'next/server'
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'
import { createAdminClient } from '@/lib/supabase/admin'
import { getValidAccessTokenForUser, listUpcomingEvents } from '@/lib/google/calendar'
import { sendPushToUser } from '@/lib/push/send'
import { getGroqClient, getGroqModel, SUPPRESS_REASONING } from '@/lib/groq/client'
import type { GroqReasoningParams } from '@/lib/groq/client'

// Vercel Hobby plan caps Cron at once/day, so this is scheduled once daily
// (see vercel.json) at one fixed UTC hour for every user rather than each
// user's actual local morning — real-time, per-user-timezone delivery needs
// frequent cron, a Pro-plan capability the user opted not to pay for. See
// the "Proactive Sofii" plan doc for the full trade-off writeup.
//
// "Today" below is the UTC calendar day for the same reason — a
// per-user-timezone "today" would need a stored timezone preference this
// app doesn't have yet, and would still be moot without frequent cron to
// act on it precisely.

const UNIQUE_VIOLATION = '23505'

function startOfTodayUtc(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function endOfTodayUtc(): Date {
  const d = startOfTodayUtc()
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

async function writeDigest(
  events: string[],
  reminders: string[],
  memories: string[]
): Promise<string> {
  const sections = [
    events.length ? `Today's calendar events:\n${events.map((e) => `- ${e}`).join('\n')}` : '',
    reminders.length ? `Reminders due today:\n${reminders.map((r) => `- ${r}`).join('\n')}` : '',
    memories.length
      ? `Things to keep in mind about the user:\n${memories.map((m) => `- ${m}`).join('\n')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await getGroqClient().chat.completions.create({
    model: getGroqModel(),
    messages: [
      {
        role: 'system',
        content:
          'Write a short, warm 2-4 sentence morning briefing summarizing the information below for the user. Natural prose, no headers or bullet points, no more than one greeting. Get straight to what actually matters today.'
      },
      { role: 'user', content: sections }
    ],
    temperature: 0.5,
    max_tokens: 300,
    ...SUPPRESS_REASONING
  } as ChatCompletionCreateParamsNonStreaming & GroqReasoningParams)

  return response.choices[0]?.message?.content?.trim() || "Here's what's on deck today."
}

export async function GET(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()
  const todayIso = startOfTodayUtc().toISOString().slice(0, 10)
  const dayStart = startOfTodayUtc().toISOString()
  const dayEnd = endOfTodayUtc().toISOString()

  const { data: subs, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('user_id')

  if (subsError) return new Response(subsError.message, { status: 500 })

  const userIds = [...new Set((subs ?? []).map((s) => s.user_id))]
  let sent = 0

  for (const userId of userIds) {
    try {
      let eventSummaries: string[] = []
      try {
        const accessToken = await getValidAccessTokenForUser(supabase, userId)
        if (accessToken) {
          const upcoming = await listUpcomingEvents(accessToken, 20)
          eventSummaries = upcoming
            .filter((e) => {
              const t = new Date(e.start).getTime()
              return t >= new Date(dayStart).getTime() && t < new Date(dayEnd).getTime()
            })
            .map((e) => `${e.summary} at ${new Date(e.start).toLocaleTimeString()}`)
        }
      } catch (err) {
        console.error(`Digest calendar fetch error for user ${userId}:`, err)
      }

      const { data: reminders } = await supabase
        .from('reminders')
        .select('content')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gte('scheduled_at', dayStart)
        .lt('scheduled_at', dayEnd)

      const { data: memories } = await supabase
        .from('memories')
        .select('content')
        .eq('user_id', userId)
        .order('use_count', { ascending: false })
        .limit(3)

      const reminderTexts = (reminders ?? []).map((r) => r.content)
      const memoryTexts = (memories ?? []).map((m) => m.content)

      // Nothing worth saying — skip both the Groq call and the push
      // entirely rather than send an empty "here's your briefing: nothing."
      if (eventSummaries.length === 0 && reminderTexts.length === 0 && memoryTexts.length === 0) {
        continue
      }

      // Claimed right before sending, not at the top of the loop — the
      // unique (user_id, sent_date) constraint is what makes a retried or
      // overlapping cron invocation safe to run twice; a user skipped above
      // for having nothing to say never occupies today's slot at all.
      const { error: claimError } = await supabase
        .from('briefings')
        .insert({ user_id: userId, sent_date: todayIso })

      if (claimError) {
        if (claimError.code === UNIQUE_VIOLATION) continue // already sent today
        throw claimError
      }

      const body = await writeDigest(eventSummaries, reminderTexts, memoryTexts)
      await sendPushToUser(supabase, userId, {
        title: "Sofii's morning briefing",
        body,
        url: '/'
      })
      sent++
    } catch (err) {
      console.error(`Digest error for user ${userId}:`, err)
    }
  }

  return Response.json({ checked: userIds.length, sent })
}
