import { TeamDetail } from '@/components/teams/TeamDetail'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { StatusType } from '@/types/enums'
import { resolveWorkflow } from '@/lib/workflow'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

interface TeamPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

export async function generateMetadata({ params }: TeamPageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  if (authRequired() && !user) return { title: 'Team · local-pm' }
  try {
    const payload = await getPayload({ config })
    const team = await payload.findByID({ collection: 'teams', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `${team.name} · local-pm` }
  } catch {
    return { title: 'Team · local-pm' }
  }
}

export default async function TeamPage({ params, searchParams }: TeamPageProps) {
  const { id } = await params
  const { tab } = await searchParams
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate (rootAccess.read
  // would deny the lookup inside the RSC otherwise → crash).
  if (authRequired() && !user) {
    return <SignedOutGate title="Team" />
  }

  try {
    const team = await payload.findByID({
      collection: 'teams',
      id,
      depth: 0,
      ...scopedLocalArgs(user),
    })
    if (!team) notFound()

    const workflow = await resolveWorkflow(payload, null)
    const idsOfType = (...types: StatusType[]) =>
      workflow.filter((entry) => types.includes(entry.type as StatusType)).map((entry) => entry.id)

    const countFor = (statusIds?: string[]) =>
      payload.count({
        collection: 'tickets',
        where: { team: { equals: id }, ...(statusIds ? { status: { in: statusIds } } : {}) },
      })

    const [total, todo, inProgress, done, members] = await Promise.all([
      countFor(),
      countFor(idsOfType(StatusType.BACKLOG, StatusType.UNSTARTED)),
      countFor(idsOfType(StatusType.STARTED)),
      countFor(idsOfType(StatusType.COMPLETED, StatusType.CANCELLED)),
      payload.find({
        collection: 'members',
        where: { team: { equals: id } },
        sort: 'name',
        limit: 100,
        depth: 0,
        ...scopedLocalArgs(user),
      }),
    ])

    return (
      <TeamDetail
        team={team}
        stats={{
          total: total.totalDocs,
          todo: todo.totalDocs,
          inProgress: inProgress.totalDocs,
          done: done.totalDocs,
        }}
        members={members.docs}
        initialTab={tab === 'tickets' ? 'tickets' : 'overview'}
      />
    )
  } catch {
    notFound()
  }
}
