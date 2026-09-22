import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ProjectDetail } from '@/components/projects/ProjectDetail'
import { StatusType } from '@/types/enums'
import { resolveWorkflow } from '@/lib/workflow'

export const dynamic = 'force-dynamic'

interface ProjectPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

export async function generateMetadata({ params }: ProjectPageProps) {
  const { id } = await params
  try {
    const payload = await getPayload({ config })
    const project = await payload.findByID({ collection: 'projects', id, depth: 0 })
    return { title: `${project.name} · local-pm` }
  } catch {
    return { title: 'Project · local-pm' }
  }
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { id } = await params
  const { tab } = await searchParams
  const payload = await getPayload({ config })

  try {
    const project = await payload.findByID({ collection: 'projects', id, depth: 0 })
    if (!project) notFound()

    const workflow = await resolveWorkflow(payload, id)
    const idsOfType = (...types: StatusType[]) =>
      workflow.filter((entry) => types.includes(entry.type as StatusType)).map((entry) => entry.id)

    const workflowIds = workflow.map((entry) => entry.id)
    const countFor = (statusIds?: string[]) =>
      payload.count({
        collection: 'tickets',
        where: {
          project: { equals: id },
          status: { in: statusIds ?? workflowIds },
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
          tab === 'tickets' || tab === 'cycles' || tab === 'estimates' || tab === 'triage'
            ? tab
            : 'overview'
        }
      />
    )
  } catch {
    notFound()
  }
}
