import { FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { listDocuments } from '@/lib/db/documents'
import DocumentList from './document-list'

export default async function DocumentsPage() {
  const supabase = await createClient()
  const documents = await listDocuments(supabase)

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 flex items-center gap-2 text-xl font-bold text-[var(--text)]">
        <FileText size={20} className="accent-text" />
        Documents
      </h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">
        Upload a PDF and Sofii will use its contents to answer your questions in chat.
      </p>
      <DocumentList initialDocuments={documents} />
    </div>
  )
}
