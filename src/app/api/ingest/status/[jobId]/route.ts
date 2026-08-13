import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getIngestionJob } from '@/lib/db/ingestion-jobs'
import { getDocument, getDocumentOcrFlag } from '@/lib/db/documents'
import { describeSupabaseError } from '@/lib/supabase/describe-error'

// RLS-scoped poll: getIngestionJob returning null (job doesn't exist, or
// belongs to someone else) is what actually enforces "only the owner can
// see this job's status" — same pattern as the conversation share route.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const { jobId } = await params
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Every helper below throws on a database error, and the documents page
  // polls this route every 2 seconds while an upload is in flight. Unhandled,
  // one transient fault becomes a 500 thirty times a minute, logged as an
  // opaque `{}` because PostgrestError does not serialise — exactly how the
  // reminder poller failed unnoticed for hundreds of requests.
  try {
    const job = await getIngestionJob(supabase, jobId)
    if (!job) return new Response('Not found', { status: 404 })

    const document =
      job.status === 'done' && job.document_id ? await getDocument(supabase, job.document_id) : null

    const flaggedForReview =
      job.status === 'done' && job.document_id
        ? await getDocumentOcrFlag(supabase, job.document_id)
        : false

    return Response.json({
      status: job.status,
      errorMessage: job.error_message,
      document,
      flaggedForReview
    })
  } catch (error) {
    console.error('Ingestion status poll failed:', jobId, describeSupabaseError(error))
    // 503, not 500: the client treats a non-OK response as "try again next
    // tick", which is the correct behaviour for a transient read failure on
    // a job that is still perfectly valid.
    return new Response('Could not read job status', { status: 503 })
  }
}
