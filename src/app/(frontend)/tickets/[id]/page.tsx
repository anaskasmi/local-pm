import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { TicketDetail } from '@/components/tickets/TicketDetail'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

interface TicketPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: TicketPageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  if (authRequired() && !user) return { title: 'Ticket · local-pm' }
  try {
    const payload = await getPayload({ config })
    const ticket = await payload.findByID({ collection: 'tickets', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `${ticket.ticketId ?? 'Ticket'} · ${ticket.title} · local-pm` }
  } catch {
    return { title: 'Ticket · local-pm' }
  }
}

export default async function TicketPage({ params }: TicketPageProps) {
  const { id } = await params
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate (the scoped ticket
  // lookup would deny inside the RSC otherwise → crash).
  if (authRequired() && !user) {
    return <SignedOutGate title="Ticket" />
  }

  try {
    const ticket = await payload.findByID({
      collection: 'tickets',
      id,
      depth: 2,
      ...scopedLocalArgs(user),
    })
    if (!ticket) notFound()
    return <TicketDetail ticket={ticket} />
  } catch {
    notFound()
  }
}
