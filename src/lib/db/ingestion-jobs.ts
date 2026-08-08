import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

export type IngestionJobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface IngestionJob {
  id: string
  status: IngestionJobStatus
  error_message: string | null
  document_id: string | null
  filename: string
}

export async function createIngestionJob(
  supabase: Client,
  params: { userId: string; filename: string }
): Promise<IngestionJob> {
  const { data, error } = await supabase
    .from('ingestion_jobs')
    .insert({ user_id: params.userId, filename: params.filename })
    .select('id, status, error_message, document_id, filename')
    .single()

  if (error) throw error
  return data as IngestionJob
}

export async function getIngestionJob(
  supabase: Client,
  jobId: string
): Promise<IngestionJob | null> {
  const { data, error } = await supabase
    .from('ingestion_jobs')
    .select('id, status, error_message, document_id, filename')
    .eq('id', jobId)
    .maybeSingle()

  if (error) throw error
  return data as IngestionJob | null
}

export async function markIngestionJobFailed(
  supabase: Client,
  jobId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from('ingestion_jobs')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('id', jobId)

  if (error) throw error
}

const STUCK_JOB_TIMEOUT_MINUTES = 10

// No cron slot available for this on Vercel Hobby (already spoken for by
// the digest cron), so this runs lazily instead: called once per Documents
// page load. A job stuck in 'processing' past the timeout means the Python
// service crashed or was killed mid-run (real OCR/embedding calls finish
// in well under this window, even Ollama's slowest observed cold-inference
// runs are ~40s) and will never update the row on its own — this is pure
// hygiene (no UI currently surfaces "your pending jobs" across sessions),
// not something the user would otherwise notice.
export async function markStuckIngestionJobsFailed(supabase: Client, userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MINUTES * 60_000).toISOString()

  const { error } = await supabase
    .from('ingestion_jobs')
    .update({ status: 'failed', error_message: 'Ingestion timed out' })
    .eq('user_id', userId)
    .eq('status', 'processing')
    .lt('updated_at', cutoff)

  if (error) throw error
}
