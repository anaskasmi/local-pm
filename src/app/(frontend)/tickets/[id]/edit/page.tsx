import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { TicketForm } from '@/components/tickets/TicketForm'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'
import type { Cycle, Member, Project, Team } from '@/payload-types'

export const dynamic = 'force-dynamic'

interface EditTicketPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ returnTo?: string }>
}

export async function generateMetadata({ params }: EditTicketPageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  if (authRequired() && !user) return { title: 'Edit ticket · local-pm' }
  try {
    const payload = await getPayload({ config })
    const ticket = await payload.findByID({ collection: 'tickets', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `Edit ${ticket.ticketId ?? ticket.title} · local-pm` }
  } catch {
    return { title: 'Edit ticket · local-pm' }
  }
}

export default async function EditTicketPage({ params, searchParams }: EditTicketPageProps) {
  const { id } = await params
  const { returnTo } = await searchParams
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate before the scoped
  // findByID.
  if (authRequired() && !user) {
    return <SignedOutGate title="Edit ticket" />
  }

  try {
    const ticket = await payload.findByID({
      collection: 'tickets',
      id,
      depth: 2,
      ...scopedLocalArgs(user),
    })
    if (!ticket) notFound()

    return (
      <TicketForm
        ticket={ticket}
        project={typeof ticket.project === 'object' ? (ticket.project as Project) : null}
        team={typeof ticket.team === 'object' ? (ticket.team as Team) : null}
        assignee={typeof ticket.assignee === 'object' ? (ticket.assignee as Member) : null}
        cycle={typeof ticket.cycle === 'object' ? (ticket.cycle as Cycle) : null}
        returnTo={returnTo}
      />
    )
  } catch {
    notFound()
  }
}
