import { headers as getHeaders } from 'next/headers'
import { getPayload } from 'payload'
import type { TypedUser, User, Where } from 'payload'
import config from '@payload-config'
import { requireAuthEnabled } from '@/lib/access'

/**
 * Resolve the signed-in account inside an RSC the same way the REST layer
 * does. Local-API calls never authenticate on their own; every page that
 * reads a collection with collectionAccess must attach `scopedLocalArgs(user)`
 * (or `user` plus `overrideAccess: false`) or the rules never run.
 */
export async function requireUser(): Promise<User | null> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  return (user as User | null) ?? null
}

/**
 * Canonical page-side flag and the single spread boundary for Local-API args:
 * both live in rbac-args.ts (import-safe without next/headers); rbac.ts
 * re-exports them so pages keep a single import site.
 */
export { authRequired, scopedLocalArgs, type SignedOutPageProps } from '@/lib/rbac-args'

/**
 * Under auth-on, an install admin (Users.role === 'admin') sees every
 * project; a member sees only the projects on their Member document.
 */
export function isInstallAdmin(user: User | TypedUser | null | undefined): boolean {
  return (user as { role?: string } | null | undefined)?.role === 'admin'
}

/**
 * Project IDs the signed-in account may see. Empty for everyone who holds no
 * membership — the caller must treat that as "no project content at all".
 */
export async function visibleProjectIds(user: User | TypedUser | null): Promise<string[]> {
  if (!user) return []
  if (isInstallAdmin(user)) return ['*']

  const ids = await _grantedProjectIds(user)
  primeMemberProjects(ids)
  return ids
}

async function _grantedProjectIds(user: User | TypedUser): Promise<string[]> {
  const payload = await getPayload({ config })
  const found = await payload.find({
    collection: 'members',
    where: { user: { equals: user.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const member = found.docs[0] as { projects?: (string | { id?: string })[] } | undefined
  const refs = Array.isArray(member?.projects) ? member!.projects : []
  const ids: string[] = []
  for (const ref of refs) {
    const id = typeof ref === 'string' ? ref : ref?.id
    if (id) ids.push(String(id))
  }
  return ids
}

/**
 * Where-clause that keeps list queries inside the caller's membership.
 * Null means "nothing at all" (authed member with no projects).
 */
export async function projectScopeWhere(
  user: User | TypedUser | null,
  field = 'project',
): Promise<Where | null> {
  const ids = await visibleProjectIds(user)
  if (ids.includes('*')) return null
  if (ids.length === 0) return { [field]: { in: [] } }
  return { [field]: { in: ids } }
}

/**
 * Page-side orphan check: true when an authenticated account holds no project
 * grants at all — no Member document, or one linking zero projects. Always
 * false for install admins. Pages answer it with the SignedOutGate orphan
 * empty state instead of running queries that can only deny.
 */
export async function hasNoProjectGrants(user: User | TypedUser | null): Promise<boolean> {
  if (!user || isInstallAdmin(user)) return false
  return (await visibleProjectIds(user)).length === 0
}

/**
 * The Member document linked to the requesting account, or null. Also the
 * single place that decides the auth-off shape (always null).
 */
export async function currentMember(): Promise<{
  user: User | null
  member: { id: string; projects?: (string | { id?: string })[]; projectRole?: string | null } | null
}> {
  const payload = await getPayload({ config })
  const user = await requireUser()
  if (!user) return { user: null, member: null }

  const found = await payload.find({
    collection: 'members',
    where: { user: { equals: user.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const member = (found.docs[0] as
    | { id: string; projects?: (string | { id?: string })[]; projectRole?: string | null }
    | undefined) ?? null
  return { user, member }
}

/**
 * Guard for single-document reads: returns true when the caller may open the
 * doc. `docProject` is the resolved owning project ID (null = no scope).
 * Callers map a false to notFound()/403 so deep links never leak.
 */
export function mayOpenProjectDoc(
  user: User | TypedUser | null,
  docProject: string | null,
): boolean {
  if (!requireAuthEnabled()) return true
  if (!user) return false
  if (isInstallAdmin(user)) return true
  if (!docProject) return false
  return memberProjectsSnapshot().has(docProject)
}

/**
 * Synchronous membership check for single-doc guards. `currentMember()` primes
 * the snapshot in the same request; always empty before that.
 */
let memberProjectsCache: { ids: string[] } | null = null

export function primeMemberProjects(ids: string[]): void {
  memberProjectsCache = { ids: [...ids] }
}

export function memberProjectsSnapshot(): Set<string> {
  return new Set(memberProjectsCache?.ids ?? [])
}
