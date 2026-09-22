import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { InitiativeForm } from '@/components/initiatives/InitiativeForm'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'
import type { Initiative } from '@/payload-types'

export const dynamic = 'force-dynamic'

interface EditInitiativePageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: EditInitiativePageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  if (authRequired() && !user) return { title: 'Edit initiative · local-pm' }
  try {
    const payload = await getPayload({ config })
    const initiative = await payload.findByID({ collection: 'initiatives', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `Edit ${initiative.name} · local-pm` }
  } catch {
    return { title: 'Edit initiative · local-pm' }
  }
}

export default async function EditInitiativePage({ params }: EditInitiativePageProps) {
  const { id } = await params
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate before the scoped
  // findByID.
  if (authRequired() && !user) {
    return <SignedOutGate title="Edit initiative" />
  }

  try {
    const initiative = (await payload.findByID({
      collection: 'initiatives',
      id,
      depth: 1,
      ...scopedLocalArgs(user),
    })) as Initiative
    if (!initiative) notFound()
    return <InitiativeForm initiative={initiative} />
  } catch {
    notFound()
  }
}
