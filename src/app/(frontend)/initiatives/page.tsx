import { InitiativesList } from '@/components/initiatives/InitiativesList'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { getPayload } from 'payload'
import config from '@payload-config'
import { requireUser, authRequired, scopedLocalArgs, hasNoProjectGrants } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Initiatives · local-pm' }

const PAGE_SIZE = 20

export default async function InitiativesPage() {
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate; orphan → no-projects
  // gate. initiativesAccess.read denies the user-less query otherwise.
  if (authRequired() && !user) {
    return <SignedOutGate title="Initiatives" />
  }
  if (authRequired() && (await hasNoProjectGrants(user))) {
    return <SignedOutGate title="Initiatives" orphan />
  }

  const result = await payload.find({
    collection: 'initiatives',
    limit: PAGE_SIZE,
    page: 1,
    depth: 1,
    sort: '-createdAt',
    ...scopedLocalArgs(user),
  })

  return (
    <InitiativesList
      initialInitiatives={result.docs}
      initialPagination={{
        page: result.page ?? 1,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        totalDocs: result.totalDocs,
      }}
    />
  )
}
