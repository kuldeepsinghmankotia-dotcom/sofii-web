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
  storage_path: string | null
}

export async function createIngestionJob(
  supabase: Client,
  params: { userId: string; filename: string; storagePath: string }
): Promise<IngestionJob> {
  const { data, error } = await supabase
    .from('ingestion_jobs')
    .insert({ user_id: params.userId, filename: params.filename, storage_path: params.storagePath })
    .select('id, status, error_message, document_id, filename, storage_path')
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
    .select('id, status, error_message, document_id, filename, storage_path')
    .eq('id', jobId)
    .maybeSingle()

  if (error) throw error
  return data as IngestionJob | null
}

const DOCUMENT_UPLOADS_BUCKET = 'document-uploads'

// Best-effort: a Storage cleanup failure shouldn't block marking a job
// failed or block the user's own retry — worst case is the same orphaned
// file this function exists to prevent, not a broken flow.
async function deleteStorageObject(supabase: Client, storagePath: string | null): Promise<void> {
  if (!storagePath) return
  try {
    // remove() reports failure by *returning* an error, it does not throw —
    // so a try/catch alone silently discards every failure. That is exactly
    // how this cleanup came to be a no-op while looking correct: files kept
    // piling up in the bucket with nothing logged anywhere.
    const { data, error } = await supabase.storage.from(DOCUMENT_UPLOADS_BUCKET).remove([storagePath])

    if (error) {
      console.error('Failed to delete orphaned Storage object:', storagePath, error.message)
      return
    }

    // An empty data array means remove() matched nothing — the usual cause
    // is RLS filtering the row out, which is *not* reported as an error.
    // Silence here would be indistinguishable from success.
    if (!data || data.length === 0) {
      console.error('Orphaned Storage object not removed (no matching object):', storagePath)
    }
  } catch (error) {
    console.error('Failed to delete orphaned Storage object:', storagePath, error)
  }
}

// storagePath is passed in by the caller (which already has it in scope
// from the upload it just did) rather than re-fetched, and cleaned up here
// — a failed ingestion job previously left its uploaded file in Storage
// forever, since nothing ever recorded where it went.
export async function markIngestionJobFailed(
  supabase: Client,
  jobId: string,
  errorMessage: string,
  storagePath?: string | null
): Promise<void> {
  const { error } = await supabase
    .from('ingestion_jobs')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('id', jobId)

  if (error) throw error
  if (storagePath) await deleteStorageObject(supabase, storagePath)
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

  // Selected first (not a blind bulk UPDATE) so each stuck job's uploaded
  // file can actually be found and cleaned up afterward — the Python
  // service that would normally do this crashed or was killed, which is
  // exactly why the job is stuck in the first place.
  const { data: stuck, error: selectError } = await supabase
    .from('ingestion_jobs')
    .select('id, storage_path')
    .eq('user_id', userId)
    .eq('status', 'processing')
    .lt('updated_at', cutoff)

  if (selectError) throw selectError
  if (!stuck || stuck.length === 0) return

  const { error: updateError } = await supabase
    .from('ingestion_jobs')
    .update({ status: 'failed', error_message: 'Ingestion timed out' })
    .in(
      'id',
      stuck.map((job) => job.id)
    )

  if (updateError) throw updateError

  await Promise.all(stuck.map((job) => deleteStorageObject(supabase, job.storage_path)))
}
