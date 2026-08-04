import { createClient } from '@/lib/supabase/server'
import { listDocuments } from '@/lib/db/documents'
import DocumentList from './document-list'

export default async function DocumentsPage() {
  const supabase = await createClient()
  const documents = await listDocuments(supabase)

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-xl font-bold">📄 Documents</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Upload a PDF and Sofii will use its contents to answer your questions in chat.
      </p>
      <DocumentList initialDocuments={documents} />
    </div>
  )
}
