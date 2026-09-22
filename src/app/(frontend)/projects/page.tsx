import { ProjectsList } from '@/components/projects/ProjectsList'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { getPayload } from 'payload'
import config from '@payload-config'
import { requireUser, projectScopeWhere, authRequired, scopedLocalArgs, hasNoProjectGrants } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Projects · local-pm' }

const PAGE_SIZE = 20

export default async function ProjectsPage() {
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session (no/stale cookie) → sign-in empty
  // state; signed in without grants (orphan) → no-projects empty state. Either
  // way, no user-less scoped query ever runs (it would throw inside the RSC).
  if (authRequired() && !user) {
    return <SignedOutGate title="Projects" />
  }
  if (authRequired() && (await hasNoProjectGrants(user))) {
    return <SignedOutGate title="Projects" orphan />
  }

  const scope = authRequired() ? await projectScopeWhere(user, 'id') : null

  const projectsResult = await payload.find({
    collection: 'projects',
    limit: PAGE_SIZE,
    page: 1,
    sort: '-createdAt',
    ...(scope ? { where: scope } : {}),
    ...scopedLocalArgs(user),
  })

  return (
    <ProjectsList
      initialProjects={projectsResult.docs}
      initialPagination={{
        page: projectsResult.page ?? 1,
        totalPages: projectsResult.totalPages,
        hasNextPage: projectsResult.hasNextPage,
        totalDocs: projectsResult.totalDocs,
      }}
    />
  )
}
