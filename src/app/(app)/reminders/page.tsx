import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { listAllReminders } from '@/lib/db/reminders'
import ReminderList from './reminder-list'

export default async function RemindersPage() {
  const supabase = await createClient()
  const reminders = await listAllReminders(supabase)

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-xl font-bold text-[var(--text)]">
        <Bell size={20} className="accent-text" />
        Reminders
      </h1>
      <ReminderList initialReminders={reminders} />
    </div>
  )
}
