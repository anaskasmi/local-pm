import { getPayload } from 'payload'
import config from '@payload-config'
import { TriageQueueView } from '@/components/triage/TriageQueueView'
import { loadTriageQueue } from '@/lib/triage-service'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Triage · local-pm' }

interface TriagePageProps {
  searchParams: Promise<{ project?: string; show?: string }>
}

export default async function TriagePage({ searchParams }: TriagePageProps) {
  const params = await searchParams
  const projectFilter = params.project || null
  const showSnoozed = params.show === 'snoozed'

  const payload = await getPayload({ config })
  const [queue, projectsResult] = await Promise.all([
    loadTriageQueue(payload, projectFilter),
    payload.find({ collection: 'projects', limit: 0, depth: 0 }),
  ])

  return (
    <TriageQueueView
      pending={queue.pending}
      snoozed={queue.snoozed}
      workflow={queue.workflow}
      enabled={queue.statuses.length > 0}
      projectFilter={projectFilter}
      showSnoozed={showSnoozed}
      hasProjects={projectsResult.totalDocs > 0}
    />
  )
}
