import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ProjectDetail } from '@/components/projects/ProjectDetail'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { StatusType } from '@/types/enums'
import { resolveWorkflow } from '@/lib/workflow'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

interface ProjectPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

export async function generateMetadata({ params }: ProjectPageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  if (authRequired() && !user) return { title: 'Project · local-pm' }
  try {
    const payload = await getPayload({ config })
    const project = await payload.findByID({ collection: 'projects', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `${project.name} · local-pm` }
  } catch {
    return { title: 'Project · local-pm' }
  }
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { id } = await params
  const { tab } = await searchParams
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: without a usable session the scoped lookup below would
  // deny inside the RSC (crash) or resolve to a misleading 404 — show the
  // sign-in gate instead.
  if (authRequired() && !user) {
    return <SignedOutGate title="Project" />
  }

  try {
    // With auth on, collectionAccess on projects runs (overrideAccess false):
    // a non-member's deep link fails here and resolves to not-found, so the
    // project's name and metadata never leak.
    const project = await payload.findByID({
      collection: 'projects',
      id,
      depth: 0,
      ...scopedLocalArgs(user),
    })
    if (!project) notFound()

    const workflow = await resolveWorkflow(payload, id)
    const idsOfType = (...types: StatusType[]) =>
      workflow.filter((entry) => types.includes(entry.type as StatusType)).map((entry) => entry.id)

    const countFor = (statusIds?: string[]) =>
      payload.count({
        collection: 'tickets',
        where: {
          project: { equals: id },
          ...(statusIds ? { status: { in: statusIds } } : {}),
        },
      })

    const [total, todo, inProgress, done, initiatives] = await Promise.all([
      countFor(),
      countFor(idsOfType(StatusType.BACKLOG, StatusType.UNSTARTED)),
      countFor(idsOfType(StatusType.STARTED)),
      countFor(idsOfType(StatusType.COMPLETED, StatusType.CANCELLED)),
      payload.find({
        collection: 'initiatives',
        where: { projects: { in: [id] } },
        limit: 20,
        depth: 0,
        sort: 'name',
        ...scopedLocalArgs(user),
      }),
    ])

    return (
      <ProjectDetail
        project={project}
        stats={{
          total: total.totalDocs,
          todo: todo.totalDocs,
          inProgress: inProgress.totalDocs,
          done: done.totalDocs,
        }}
        initiatives={initiatives.docs}
        initialTab={
          tab === 'tickets' || tab === 'cycles' || tab === 'estimates' ? tab : 'overview'
        }
      />
    )
  } catch {
    notFound()
  }
}
