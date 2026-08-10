import { MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isWhatsAppConfigured } from '@/lib/whatsapp/client'
import { PageHeader } from '../page-header'
import WhatsAppLink from './whatsapp-link'

export default async function WhatsAppPage() {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  // RLS restricts this to the caller's own links, so no explicit filter is
  // needed — this is a session-scoped client, unlike the webhook's.
  const { data: links } = await supabase
    .from('whatsapp_links')
    .select('phone, display_name, linked_at')
    .order('linked_at', { ascending: false })

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader
        icon={MessageCircle}
        title="WhatsApp"
        description="Talk to Sofii on WhatsApp — send a message or a voice note, in any language, and it remembers everything from here."
      />
      <WhatsAppLink
        available={isWhatsAppConfigured()}
        initialLinks={links ?? []}
        signedIn={Boolean(user)}
      />
    </div>
  )
}
