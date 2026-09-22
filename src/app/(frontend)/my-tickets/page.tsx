import { headers as getHeaders } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import { MyTickets, type SignedInUser } from '@/components/tickets/MyTickets'
import { scopedLocalArgs } from '@/lib/rbac'
import type { Member } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My tickets · local-pm' }

export default async function MyTicketsPage() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  const authed = Boolean(user)

  let member: Member | null = null
  let signedInAs: SignedInUser | null = null

  if (user) {
    signedInAs = {
      id: String(user.id),
      name: (user as { name?: string | null }).name ?? null,
      email: user.email ?? null,
    }

    const found = await payload.find({
      collection: 'members',
      where: { user: { equals: user.id } },
      limit: 1,
      depth: 0,
      ...scopedLocalArgs(user),
    })
    member = found.docs[0] ?? null
  }

  return <MyTickets member={member} signedInAs={signedInAs} canReadTickets={authed} />
}
