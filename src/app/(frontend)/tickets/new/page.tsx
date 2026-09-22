import { getPayload } from 'payload'
import config from '@payload-config'
import { TicketForm } from '@/components/tickets/TicketForm'
import { resolveWorkflow } from '@/lib/workflow'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
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
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate; the prefetches below
  // would deny inside the RSC otherwise → crash.
  if (authRequired() && !user) {
    return <SignedOutGate title="New ticket" />
  }

  const authedArgs: Record<string, unknown> = {}
  if (authRequired()) {
    authedArgs.user = user ?? undefined
    authedArgs.overrideAccess = false
  }

  const workflow = await resolveWorkflow(payload, projectId)
  const requested = params.status ?? ''
  const status =
    workflow.find((entry) => entry.id === requested || entry.key === requested)?.id ??
    workflow[0]?.id ??
    ''

  let project: Project | null = null
  if (projectId) {
    try {
      project = await payload.findByID({
        collection: 'projects',
        id: projectId,
        depth: 0,
        ...authedArgs,
      })
    } catch {
      project = null
    }
  }

  const [team, assignee, cycle] = (await Promise.all([
    params.team
      ? payload
          .findByID({ collection: 'teams', id: params.team, depth: 0, ...authedArgs })
          .catch(() => null)
      : null,
    params.assignee
      ? payload
          .findByID({ collection: 'members', id: params.assignee, depth: 0, ...authedArgs })
          .catch(() => null)
      : null,
    params.cycle
      ? payload
          .findByID({ collection: 'cycles', id: params.cycle, depth: 0, ...authedArgs })
          .catch(() => null)
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
