import { FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { listDocuments } from '@/lib/db/documents'
import { PageHeader } from '../page-header'
import DocumentList from './document-list'

export default async function DocumentsPage() {
  const supabase = await createClient()
  const documents = await listDocuments(supabase)

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader
        icon={FileText}
        title="Documents"
        description="Upload a PDF and Sofii will use its contents to answer your questions in chat."
      />
      <DocumentList initialDocuments={documents} />
    </div>
  )
}
