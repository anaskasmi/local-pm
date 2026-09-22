import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { InitiativeDetail } from '@/components/initiatives/InitiativeDetail'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { rollupProjects } from '@/lib/initiative-stats'
import { projectRefsOf } from '@/lib/initiative'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'
import type { Initiative } from '@/payload-types'

export const dynamic = 'force-dynamic'

interface InitiativePageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: InitiativePageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  if (authRequired() && !user) return { title: 'Initiative · local-pm' }
  try {
    const payload = await getPayload({ config })
    const initiative = await payload.findByID({ collection: 'initiatives', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `${initiative.name} · local-pm` }
  } catch {
    return { title: 'Initiative · local-pm' }
  }
}

export default async function InitiativePage({ params }: InitiativePageProps) {
  const { id } = await params
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate (initiativesAccess
  // denies the user-less lookup inside the RSC otherwise → crash).
  if (authRequired() && !user) {
    return <SignedOutGate title="Initiative" />
  }

  try {
    const initiative = (await payload.findByID({
      collection: 'initiatives',
      id,
      depth: 1,
      ...scopedLocalArgs(user),
    })) as Initiative
    if (!initiative) notFound()

    const projects = projectRefsOf(initiative)
    const rollups = await rollupProjects(payload, projects)

    return <InitiativeDetail initiative={initiative} projectRollups={rollups} />
  } catch {
    notFound()
  }
}
