import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { getPayload } from 'payload'
import config from '@payload-config'
import { resolveWorkflow } from '@/lib/workflow'
import type { Where } from 'payload'
import { ticketSearchWhere } from '@/lib/ticket-search'
import { requireUser, projectScopeWhere, authRequired, scopedLocalArgs, hasNoProjectGrants } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Board · local-pm' }

const TICKETS_PER_COLUMN = 20

interface BoardPageProps {
  searchParams: Promise<{
    project?: string
    team?: string
    assignee?: string
    cycle?: string
    q?: string
  }>
}

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const params = await searchParams
  const projectFilter = params.project || null
  const teamFilter = params.team || null
  const assigneeFilter = params.assignee || null
  const cycleFilter = params.cycle || null
  const query = (params.q || '').trim()

  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: with auth on but no usable session (no cookie, stale
  // cookie, first visit), render the sign-in empty state instead of letting a
  // user-less scoped query run — collectionAccess would throw inside the RSC
  // and surface as the route error boundary.
  if (authRequired() && !user) {
    return <SignedOutGate title="Board" />
  }

  const scope = authRequired() ? await projectScopeWhere(user) : null

  // Orphan: signed in but holding no project grants. Same gate, no-crash copy.
  if (authRequired() && (await hasNoProjectGrants(user))) {
    return <SignedOutGate title="Board" orphan />
  }

  // A deep link into a project outside this membership resolves to nothing,
  // not to a leak: the scope narrows whatever the URL asked for.
  const constrainedProject =
    projectFilter && Array.isArray((scope as { project?: { in?: string[] } })?.project?.in)
      ? ((scope as { project: { in: string[] } }).project.in.includes(projectFilter)
          ? projectFilter
          : 'none')
      : projectFilter

  const statuses = await resolveWorkflow(payload, constrainedProject)

  const buildWhere = (statusId: string): Where => {
    const conditions: Where = { status: { equals: statusId } }
    if (constrainedProject) conditions.project = { equals: constrainedProject }
    if (teamFilter) conditions.team = { equals: teamFilter }
    if (assigneeFilter) conditions.assignee = { equals: assigneeFilter }
    if (cycleFilter) conditions.cycle = { equals: cycleFilter }
    if (query) Object.assign(conditions, ticketSearchWhere(query))
    if (scope) Object.assign(conditions, scope)
    return conditions
  }

  const [columnResults, projectsResult] = await Promise.all([
    Promise.all(
      statuses.map((status) =>
        payload.find({
          collection: 'tickets',
          limit: TICKETS_PER_COLUMN,
          page: 1,
          sort: 'sortOrder',
          depth: 2,
          where: buildWhere(status.id),
          ...scopedLocalArgs(user),
        }),
      ),
    ),
    payload.find({
      collection: 'projects',
      limit: 0,
      depth: 0,
      ...scopedLocalArgs(user),
    }),
  ])

  const initialTickets = columnResults.flatMap((result) => result.docs)

  const initialColumnPagination = statuses.map((status, index) => ({
    status: status.id,
    page: columnResults[index].page ?? 1,
    totalPages: columnResults[index].totalPages,
    hasNextPage: columnResults[index].hasNextPage,
    totalDocs: columnResults[index].totalDocs,
  }))

  return (
    <KanbanBoard
      initialTickets={initialTickets}
      statuses={statuses}
      hasProjects={projectsResult.totalDocs > 0}
      initialColumnPagination={initialColumnPagination}
    />
  )
}
