import { FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { listDocuments } from '@/lib/db/documents'
import { markStuckIngestionJobsFailed } from '@/lib/db/ingestion-jobs'
import { PageHeader } from '../page-header'
import DocumentList from './document-list'
import AskDocuments from './ask-documents'

export default async function DocumentsPage() {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  // Lazy cleanup (no cron slot available - see markStuckIngestionJobsFailed's
  // own comment): runs once per page load, not user-visible in itself.
  if (user) await markStuckIngestionJobsFailed(supabase, user.id)

  const documents = await listDocuments(supabase)

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader
        icon={FileText}
        title="Documents"
        description="Upload a PDF, .docx, .txt, .html, .csv, or image file and Sofii will use its contents to answer your questions in chat."
      />
      <DocumentList initialDocuments={documents} />
      <AskDocuments documents={documents} />
    </div>
  )
}
