import { AlertTriangle, FileText } from 'lucide-react'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { listDocuments } from '@/lib/db/documents'
import { markStuckIngestionJobsFailed } from '@/lib/db/ingestion-jobs'
import { isIngestServiceOnline } from '@/lib/ingestion/health'
import { PageHeader } from '../page-header'
import DocumentList from './document-list'
import AskDocuments from './ask-documents'

export default async function DocumentsPage() {
  const supabase = await createClient()
  const user = await getCurrentUser()

  // Lazy cleanup (no cron slot available - see markStuckIngestionJobsFailed's
  // own comment): runs once per page load, not user-visible in itself.
  if (user) await markStuckIngestionJobsFailed(supabase, user.id)

  const [documents, serviceOnline] = await Promise.all([listDocuments(supabase), isIngestServiceOnline()])

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader
        icon={FileText}
        title="Documents"
        description="Upload a PDF, .docx, .pptx, .xlsx, .txt, .md, .html, .csv, or image file (or paste a web page URL) and Sofii will use its contents to answer your questions in chat."
      />
      {!serviceOnline && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            {/* OCR moved in-app with Sarvam Vision, so photos and scans no
                longer depend on this service. Saying otherwise would send
                someone away from something that works. */}
            <strong>Some document tools are temporarily offline.</strong> Office files (.docx, .xlsx,
            .pptx, .csv) and web-page links can&apos;t be processed right now, and &quot;Ask about your
            documents&quot; is unavailable. <strong>PDFs and photos still work</strong>, and your
            existing documents and chat are unaffected.
          </div>
        </div>
      )}
      <DocumentList initialDocuments={documents} serviceOnline={serviceOnline} />
      <AskDocuments documents={documents} />
    </div>
  )
}
