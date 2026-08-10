import { ListChecks } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '../page-header'
import TaskList from './task-list'
import type { AgentTask } from './task-panel'

export default async function TasksPage() {
  const supabase = await createClient()

  // RLS scopes this to the caller.
  const { data: tasks } = await supabase
    .from('agent_tasks')
    .select('id, goal, status, summary, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader
        icon={ListChecks}
        title="Tasks"
        description="Give Sofii something that takes several steps — researching options, gathering and comparing information — and watch it work through the plan."
      />
      {/* Cast: the generated row type widens status to string, while
          AgentTask narrows it to the union. The database check constraint
          already guarantees the narrower set. */}
      <TaskList initialTasks={(tasks ?? []) as AgentTask[]} />
    </div>
  )
}
