import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getIngestionJob } from '@/lib/db/ingestion-jobs'
import { getDocument, getDocumentOcrFlag } from '@/lib/db/documents'

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
}
