import { getPayload } from 'payload'
import config from '@payload-config'
import { TicketForm } from '@/components/tickets/TicketForm'
import { splitWorkflow } from '@/lib/triage'
import { resolveAllStatuses } from '@/lib/workflow'
import type { Cycle, Project, Team, Member } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New ticket · local-pm' }

interface NewTicketPageProps {
  searchParams: Promise<{
    project?: string
    team?: string
    assignee?: string
    cycle?: string
    status?: string
    returnTo?: string
  }>
}

export default async function NewTicketPage({ searchParams }: NewTicketPageProps) {
  const params = await searchParams
  const projectId = params.project || null
  const payload = await getPayload({ config })
  const workflow = await resolveAllStatuses(payload, projectId)
  const requested = params.status ?? ''
  const selectable = splitWorkflow(workflow)
  const status =
    workflow.find((entry) => entry.id === requested || entry.key === requested)?.id ??
    selectable.workflow[0]?.id ??
    ''

  let project: Project | null = null
  if (projectId) {
    try {
      project = await payload.findByID({ collection: 'projects', id: projectId, depth: 0 })
    } catch {
      project = null
    }
  }

  const [team, assignee, cycle] = (await Promise.all([
    params.team
      ? payload.findByID({ collection: 'teams', id: params.team, depth: 0 }).catch(() => null)
      : null,
    params.assignee
      ? payload.findByID({ collection: 'members', id: params.assignee, depth: 0 }).catch(() => null)
      : null,
    params.cycle
      ? payload.findByID({ collection: 'cycles', id: params.cycle, depth: 0 }).catch(() => null)
      : null,
  ])) as [Team | null, Member | null, Cycle | null]

  return (
    <TicketForm
      ticket={null}
      project={project}
      team={team}
      assignee={assignee}
      cycle={cycle}
      defaultProjectId={project?.id ?? null}
      defaultStatus={status}
      returnTo={
        params.returnTo?.startsWith('/') && !params.returnTo.startsWith('//')
          ? params.returnTo
          : undefined
      }
    />
  )
}
