import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { CycleDetail } from '@/components/cycles/CycleDetail'
import { cycleSettingsOf } from '@/lib/cycle-service'
import { loadBurndown, snapshotOf } from '@/lib/burndown-service'
import { cycleProgress } from '@/lib/cycles'
import { CycleAutomation } from '@/types/enums'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import type { Cycle, Project } from '@/payload-types'

export const dynamic = 'force-dynamic'

interface CyclePageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: CyclePageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  if (authRequired() && !user) return { title: 'Cycle · local-pm' }
  try {
    const payload = await getPayload({ config })
    const cycle = await payload.findByID({ collection: 'cycles', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `${cycle.name} · local-pm` }
  } catch {
    return { title: 'Cycle · local-pm' }
  }
}

export default async function CyclePage({ params }: CyclePageProps) {
  const { id } = await params
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate (the scoped cycle
  // lookup would deny inside the RSC otherwise → crash).
  if (authRequired() && !user) {
    return <SignedOutGate title="Cycle" />
  }

  const authedArgs: Record<string, unknown> = {}
  if (authRequired()) {
    authedArgs.user = user ?? undefined
    authedArgs.overrideAccess = false
  }

  try {
    const cycle = (await payload.findByID({
      collection: 'cycles',
      id,
      depth: 1,
      ...authedArgs,
    })) as Cycle
    if (!cycle) notFound()

    const project =
      typeof cycle.project === 'object'
        ? (cycle.project as Project)
        : ((await payload.findByID({
            collection: 'projects',
            id: String(cycle.project),
            depth: 0,
            ...authedArgs,
          })) as Project)

    const tickets = await payload.find({
      collection: 'tickets',
      where: { cycle: { equals: id } },
      limit: 2000,
      depth: 1,
      ...authedArgs,
    })

    const progress = cycleProgress(
      tickets.docs.map((ticket) => {
        const status = ticket.status
        return status && typeof status === 'object' ? status.type : null
      }),
    )

    const settings = cycleSettingsOf(project)
    const burndown = await loadBurndown(payload, cycle, project)

    return (
      <CycleDetail
        cycle={{ ...cycle, project: project.id }}
        project={project}
        progress={progress}
        burndown={burndown}
        frozen={Boolean(snapshotOf(cycle))}
        closable={settings.enabled && settings.automation === CycleAutomation.MANUAL}
      />
    )
  } catch {
    notFound()
  }
}
