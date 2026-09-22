import { TeamsList } from '@/components/teams/TeamsList'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { getPayload } from 'payload'
import config from '@payload-config'
import { requireUser, authRequired, scopedLocalArgs, hasNoProjectGrants } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Teams · local-pm' }

const PAGE_SIZE = 20

export default async function TeamsPage() {
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate; orphan → no-projects
  // gate. memberGate denies the user-less query inside the RSC otherwise.
  if (authRequired() && !user) {
    return <SignedOutGate title="Teams" />
  }
  if (authRequired() && (await hasNoProjectGrants(user))) {
    return <SignedOutGate title="Teams" orphan />
  }

  const teamsResult = await payload.find({
    collection: 'teams',
    limit: PAGE_SIZE,
    page: 1,
    sort: '-createdAt',
    ...scopedLocalArgs(user),
  })

  return (
    <TeamsList
      initialTeams={teamsResult.docs}
      initialPagination={{
        page: teamsResult.page ?? 1,
        totalPages: teamsResult.totalPages,
        hasNextPage: teamsResult.hasNextPage,
        totalDocs: teamsResult.totalDocs,
      }}
    />
  )
}
