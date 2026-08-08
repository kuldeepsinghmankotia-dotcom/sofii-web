import { Redis } from '@upstash/redis'

// Upstash's marketplace integration for Vercel sets KV_REST_API_URL/TOKEN
// (the older "Vercel KV" naming convention it's backward-compatible with),
// not UPSTASH_REDIS_REST_URL/TOKEN — so Redis.fromEnv() (which looks for
// the latter) won't find them. Constructed explicitly instead.
let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.KV_REST_API_URL
    const token = process.env.KV_REST_API_TOKEN
    if (!url || !token) throw new Error('KV_REST_API_URL/KV_REST_API_TOKEN are not set')
    client = new Redis({ url, token })
  }
  return client
}
