import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { listAllReminders } from '@/lib/db/reminders'
import { PageHeader } from '../page-header'
import ReminderList from './reminder-list'

export default async function RemindersPage() {
  const supabase = await createClient()
  const reminders = await listAllReminders(supabase)

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader icon={Bell} title="Reminders" />
      <ReminderList initialReminders={reminders} />
    </div>
  )
}
