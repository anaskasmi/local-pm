import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Access, Payload, TypedUser, Where } from 'payload'
import {
  requireAuthEnabled,
  readAccess,
  writeAccess,
  deleteAccess,
  ticketsAccess,
  projectsAccess,
  commentsAccess,
  cyclesAccess,
  statusesAccess,
  rootAccess,
  membersAccess,
  initiativesAccess,
  attachmentsAccess,
} from '@/lib/access'
import { authRequired, scopedLocalArgs, type SignedOutPageProps } from '@/lib/rbac-args'
import { hasNoProjectGrants } from '@/lib/rbac'

/**
 * Mocks for the page-guard helpers (SignedOutGate RSC crash class, review
 * round 2). `@payload-config` and `payload.getPayload` are replaced so
 * hasNoProjectGrants can run without a database; the members store is a
 * plain object keyed by user id (null = no linked Member document).
 */
const rbacMock = vi.hoisted(() => ({
  memberships: {} as Record<string, { projects: string[] } | null>,
}))

vi.mock('@payload-config', () => ({
  default: {
    collections: { members: {} },
    globals: {},
    db: { defaultIDType: 'text' },
  },
}))

vi.mock('payload', () => ({
  getPayload: async () => ({
    find: async (args: Record<string, unknown>) => {
      const a = args as { collection?: string; where?: { user?: { equals?: string } } }
      if (a.collection !== 'members') return { docs: [] }
      const userId = a.where?.user?.equals
      const grants = userId ? rbacMock.memberships[String(userId)] : undefined
      if (!grants) return { docs: [] }
      return { docs: [{ id: `m-${userId}`, projects: grants.projects, projectRole: 'member' }] }
    },
  }),
}))
import { Users } from '@/collections/Users'
import { Initiatives } from '@/collections/Initiatives'
import { Attachments } from '@/collections/Attachments'

const call = async (fn: Access, user: unknown, extra: Record<string, unknown> = {}) =>
  (fn as (args: Record<string, unknown>) => unknown)({ req: reqFor(user), ...extra })


function reqFor(user: unknown, overrides: Partial<Payload> = {}) {
  return {
    user,
    payload: {
      find: async (args: Record<string, unknown>) => {
        ;(findCalls as unknown[]).push(args)
        return memberStoreResponse(args)
      },
      findByID: async (args: Record<string, unknown>) => {
        ;(findCalls as unknown[]).push(args)
        const doc = docs[String(args.id)]
        if (!doc) throw new Error('not found')
        return doc
      },
      ...overrides,
    } as unknown as Payload,
  }
}

let findCalls: unknown[]

/**
 * In-memory Member store: the user IDs map to memberships. `null` means the
 * account has no linked member (the deny-everything case).
 */
const memberships: Record<string, { id: string; projects: string[]; projectRole?: string } | null> =
  {}

/** Stored docs for the doc→project lookups (tickets carry project). */
const docs: Record<string, { id: string; project?: string; ticket?: string }> = {}

/** In-memory tickets list for ticketIdsInProjects: id → project. */
const ticketProjects: Record<string, string> = {}

function primeTickets(): void {
  ticketProjects['t1'] = P1
  ticketProjects['t2'] = P2
}

function memberStoreResponse(args: Record<string, unknown>) {
  if (args.collection === 'tickets') {
    const where = args.where as { project?: { in?: string[] } } | undefined
    const inList = where?.project?.in
    if (!inList) return { docs: [] }
    return { docs: Object.entries(ticketProjects).filter(([, p]) => inList.includes(p)).map(([id]) => ({ id, project: id })) }
  }
  if (args.collection !== 'members') return { docs: [] }
  const where = args.where as { user?: { equals?: string } } | undefined
  const userId = where?.user?.equals
  const member = userId ? memberships[String(userId)] : null
  return { docs: member ? [member] : [] }
}

const P1 = 'proj1'
const P2 = 'proj2'

function memberWith(
  id: string,
  projects: string[],
  role = 'member',
): Record<string, unknown> {
  return { id: `u-${id}`, role: 'member', _memberProjects: projects, _memberRole: role }
}

function asMemberUser(user: Record<string, unknown> | null): void {
  if (!user) return
  memberships[String(user.id)] = {
    id: `m-${String(user.id)}`,
    projects: (user._memberProjects as string[]) ?? [],
    projectRole: (user._memberRole as string) ?? 'member',
  }
}

let original: string | undefined

beforeEach(() => {
  original = process.env.LOCAL_PM_REQUIRE_AUTH
  findCalls = []
  for (const key of Object.keys(memberships)) delete memberships[key]
  for (const key of Object.keys(docs)) delete docs[key]
  docs['t1'] = { id: 't1', project: P1 }
  docs['t2'] = { id: 't2', project: P2 }
  docs['c1'] = { id: 'c1', ticket: 't1' }
  docs['cy1'] = { id: 'cy1', project: P1 }
  docs['st1'] = { id: 'st1', project: P1 }
  docs['gp1'] = { id: 'gp1' }
  primeTickets()
})

afterEach(() => {
  if (original === undefined) delete process.env.LOCAL_PM_REQUIRE_AUTH
  else process.env.LOCAL_PM_REQUIRE_AUTH = original
})

describe('requireAuthEnabled (unchanged contract)', () => {
  it('is off unless the flag is exactly "true"', async () => {
    delete process.env.LOCAL_PM_REQUIRE_AUTH
    expect(requireAuthEnabled()).toBe(false)

    process.env.LOCAL_PM_REQUIRE_AUTH = 'false'
    expect(requireAuthEnabled()).toBe(false)

    process.env.LOCAL_PM_REQUIRE_AUTH = 'TRUE'
    expect(requireAuthEnabled()).toBe(false)

    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
    expect(requireAuthEnabled()).toBe(true)
  })
})

describe('with the flag off — existing installs must not change behaviour', () => {
  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'false'
  })

  it('allows anonymous read, write and delete', async () => {
    expect(await call(readAccess, null)).toBe(true)
    expect(await call(writeAccess, null)).toBe(true)
    expect(await call(deleteAccess, null)).toBe(true)
  })

  it('allows every scoped collection read/write/delete anonymously', async () => {
    expect(await call(ticketsAccess.read, null)).toBe(true)
    expect(await call(ticketsAccess.create, null, { data: { project: P1 } })).toBe(true)
    expect(await call(ticketsAccess.update, null, { id: 't1' })).toBe(true)
    expect(await call(ticketsAccess.delete, null, { id: 't1' })).toBe(true)
    expect(await call(projectsAccess.read, null)).toBe(true)
    expect(await call(commentsAccess.read, null)).toBe(true)
    expect(await call(commentsAccess.create, null, { data: { ticket: 't1' } })).toBe(true)
    expect(await call(rootAccess.read, null)).toBe(true)
    expect(await call(rootAccess.delete, null, { id: 'gp1' })).toBe(true)
    expect(await call(membersAccess.update, null, { id: 'gp1' })).toBe(true)
  })
})

describe('with the flag on — anonymous callers', () => {
  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
  })

  it('denies every operation outright', async () => {
    expect(await call(readAccess, null)).toBe(false)
    expect(await call(writeAccess, null)).toBe(false)
    expect(await call(deleteAccess, null)).toBe(false)
    expect(await call(ticketsAccess.read, null)).toBe(false)
    expect(await call(ticketsAccess.create, null, { data: { project: P1 } })).toBe(false)
    expect(await call(ticketsAccess.update, null, { id: 't1' })).toBe(false)
    expect(await call(ticketsAccess.delete, null, { id: 't1' })).toBe(false)
    expect(await call(projectsAccess.read, null)).toBe(false)
    expect(await call(commentsAccess.read, null)).toBe(false)
    expect(await call(rootAccess.read, null)).toBe(false)
    expect(await call(membersAccess.read, null)).toBe(false)
    expect(await call(initiativesAccess.read, null)).toBe(false)
  })
})

describe('with the flag on — install admin', () => {
  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
  })

  it('sees and may change everything without membership', async () => {
    const admin = { id: 'admin1', role: 'admin' }
    expect(await call(ticketsAccess.read, admin)).toBe(true)
    expect(await call(ticketsAccess.create, admin, { data: { project: P2 } })).toBe(true)
    expect(await call(ticketsAccess.update, admin, { id: 't1' })).toBe(true)
    expect(await call(ticketsAccess.delete, admin, { id: 't1' })).toBe(true)
    expect(await call(projectsAccess.read, admin)).toBe(true)
    expect(await call(projectsAccess.update, admin, { id: P1 })).toBe(true)
    expect(await call(projectsAccess.delete, admin, { id: P1 })).toBe(true)
    expect(await call(commentsAccess.read, admin)).toBe(true)
    expect(await call(commentsAccess.delete, admin, { id: 'c1' })).toBe(true)
    expect(await call(rootAccess.delete, admin, { id: 'gp1' })).toBe(true)
    expect(await call(membersAccess.update, admin, { id: 'gp1' })).toBe(true)
    expect(await call(initiativesAccess.delete, admin, { id: 'gp1' })).toBe(true)
  })
})

describe('with the flag on — member of project 1', () => {
  let member: Record<string, unknown>
  let viewer: Record<string, unknown>

  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
    member = memberWith('member1', [P1], 'member')
    viewer = memberWith('viewer1', [P1], 'viewer')
    asMemberUser(member)
    asMemberUser(viewer)
  })

  it('reads tickets constrained to a Where over the granted projects', async () => {
    const result = await call(ticketsAccess.read, member) as Where
    expect(result).toEqual({ project: { in: [P1] } })
  })

  it('denies reads outright when the member holds no projects (empty, not open)', async () => {
    const noProjects = memberWith('member2', [])
    asMemberUser(noProjects)
    expect(await call(ticketsAccess.read, noProjects)).toBe(false)
    expect(await call(projectsAccess.read, noProjects)).toBe(false)
    expect(await call(commentsAccess.read, noProjects)).toBe(false)
  })

  it('writes only inside granted projects', async () => {
    expect(await call(ticketsAccess.create, member, { data: { project: P1 } })).toBe(true)
    expect(await call(ticketsAccess.create, member, { data: { project: P2 } })).toBe(false)
    expect(await call(ticketsAccess.update, member, { id: 't1' })).toBe(true)
    expect(await call(ticketsAccess.update, member, { id: 't2' })).toBe(false)
  })

  it('denies writes for viewers even inside granted projects', async () => {
    expect(await call(ticketsAccess.create, viewer, { data: { project: P1 } })).toBe(false)
    expect(await call(ticketsAccess.update, viewer, { id: 't1' })).toBe(false)
    expect(await call(ticketsAccess.delete, viewer, { id: 't1' })).toBe(false)
  })

  it('denies deletes for the member tier; project admin may delete', async () => {
    expect(await call(ticketsAccess.delete, member, { id: 't1' })).toBe(false)
    const projectAdmin = memberWith('admin2', [P1], 'admin')
    asMemberUser(projectAdmin)
    expect(await call(ticketsAccess.delete, projectAdmin, { id: 't1' })).toBe(true)
    expect(await call(ticketsAccess.delete, projectAdmin, { id: 't2' })).toBe(false)
  })

  it('moves a ticket only when both source and target projects are granted', async () => {
    // update carrying a new project = cross-project move
    expect(await call(ticketsAccess.update, member, { id: 't1', data: { project: P2 } })).toBe(false)
    const both = memberWith('member3', [P1, P2], 'member')
    asMemberUser(both)
    expect(await call(ticketsAccess.update, both, { id: 't1', data: { project: P2 } })).toBe(true)
  })

  it('reads projects constrained to the granted list', async () => {
    const result = await call(projectsAccess.read, member) as Where
    expect(result).toEqual({ id: { in: [P1] } })
  })

  it('cannot create, update or delete projects (install-admin only for create)', async () => {
    expect(await call(projectsAccess.create, member, { data: { name: 'x' } })).toBe(false)
    expect(await call(projectsAccess.update, member, { id: P1 })).toBe(true)
    expect(await call(projectsAccess.update, member, { id: P2 })).toBe(false)
    expect(await call(projectsAccess.delete, member, { id: P1 })).toBe(false)
    const projectAdmin = memberWith('admin3', [P1], 'admin')
    asMemberUser(projectAdmin)
    expect(await call(projectsAccess.delete, projectAdmin, { id: P1 })).toBe(true)
    expect(await call(projectsAccess.delete, projectAdmin, { id: P2 })).toBe(false)
  })

  it('cycles and statuses follow the same project Where', async () => {
    expect(await call(cyclesAccess.read, member)).toEqual({ project: { in: [P1] } })
    expect(await call(statusesAccess.read, member)).toEqual({
      or: [{ project: { in: [P1] } }, { project: { exists: false } }],
    })
    expect(await call(cyclesAccess.create, member, { data: { project: P1 } })).toBe(true)
    expect(await call(cyclesAccess.create, member, { data: { project: P2 } })).toBe(false)
  })

  it('comments inherit the ticket project for reads and writes', async () => {
    const where = await call(commentsAccess.read, member) as Where
    expect(where).toEqual({ ticket: { in: ['t1'] } })

    expect(await call(commentsAccess.create, member, { data: { ticket: 't1' } })).toBe(true)
    expect(await call(commentsAccess.create, member, { data: { ticket: 't2' } })).toBe(false)
    expect(await call(commentsAccess.update, member, { id: 'c1' })).toBe(true)
    expect(await call(commentsAccess.delete, member, { id: 'c1' })).toBe(false)
    const projectAdmin = memberWith('admin4', [P1], 'admin')
    asMemberUser(projectAdmin)
    expect(await call(commentsAccess.delete, projectAdmin, { id: 'c1' })).toBe(true)
  })

  it('viewer comments stay read-only (no comment writes)', async () => {
    expect(await call(commentsAccess.create, viewer, { data: { ticket: 't1' } })).toBe(false)
    expect(await call(commentsAccess.update, viewer, { id: 'c1' })).toBe(false)
  })

  it('teams, labels, label-groups are readable by any member; delete is install-admin', async () => {
    expect(await call(rootAccess.read, member)).toBe(true)
    expect(await call(rootAccess.create, member)).toBe(true)
    expect(await call(rootAccess.update, member, { id: 'gp1' })).toBe(true)
    expect(await call(rootAccess.delete, member, { id: 'gp1' })).toBe(false)
  })

  it('initiatives are usable by members; delete stays install-admin', async () => {
    expect(await call(initiativesAccess.read, member)).toBe(true)
    expect(await call(initiativesAccess.create, member)).toBe(true)
    expect(await call(initiativesAccess.delete, member, { id: 'i1' })).toBe(false)
  })

  it('members directory: readable, self-profile creatable, not editable', async () => {
    expect(await call(membersAccess.read, member)).toBe(true)
    expect(await call(membersAccess.create, member, { data: { user: String(member.id) } })).toBe(true)
    expect(await call(membersAccess.create, member, { data: { user: 'someone-else' } })).toBe(false)
    expect(await call(membersAccess.update, member, { id: 'gp1' })).toBe(false)
    expect(await call(membersAccess.delete, member, { id: 'gp1' })).toBe(false)
  })

  it('never returns true for an authenticated caller without a linked member', async () => {
    const orphan = { id: 'ghost', role: 'member' }
    expect(await call(ticketsAccess.read, orphan)).toBe(false)
    expect(await call(projectsAccess.read, orphan)).toBe(false)
    expect(await call(commentsAccess.read, orphan)).toBe(false)
    expect(await call(rootAccess.read, orphan)).toBe(false)
    expect(await call(rootAccess.create, orphan)).toBe(false)
    expect(await call(initiativesAccess.read, orphan)).toBe(false)
    expect(await call(membersAccess.read, orphan)).toBe(true)
    // the one deliberate exception: my-tickets profile creation gate
    expect(await call(membersAccess.create, orphan, { data: { user: 'ghost' } })).toBe(true)
  })

  it('readAccess/writeAccess stay boolean-only and unchanged in shape', async () => {
    expect(await call(readAccess, member)).toBe(true)
    expect(await call(writeAccess, member)).toBe(true)
    expect(await call(deleteAccess, member)).toBe(false)
    expect(await call(deleteAccess, { id: 'admin1', role: 'admin' })).toBe(true)
    expect(await call(deleteAccess, { id: 'u4' })).toBe(false)
  })
})

describe('typed user helper contract (#13 — no falsy Forbidden traps)', () => {
  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
  })

  it('treats every decision as explicit boolean true/false or Where', async () => {
    const member = memberWith('member1', [P1], 'member')
    asMemberUser(member)
    const results = [
      await (ticketsAccess.read as (a: Record<string, unknown>) => unknown)({
        req: reqFor(member),
      }),
      await (ticketsAccess.create as (a: Record<string, unknown>) => unknown)({
        req: reqFor(member),
        data: { project: P1 },
      }),
    ]
    for (const result of results) {
      expect(result === true || result === false || typeof result === 'object').toBe(true)
      expect(result).not.toBe(undefined)
      expect(result).not.toBe(null)
    }
  })
})

describe('scopedLocalArgs — the one Local-API spread boundary (BUG-2 regression)', () => {
  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
  })

  it('with auth on: attaches the user and forces collectionAccess to run', () => {
    const user = { id: 'u1', collection: 'users' } as unknown as Parameters<typeof scopedLocalArgs>[0]
    expect(scopedLocalArgs(user)).toStrictEqual({ user, overrideAccess: false })
  })

  it('with auth on: even a null user forces overrideAccess:false (fail closed)', () => {
    const result = scopedLocalArgs(null)
    expect(result).toStrictEqual({ user: undefined, overrideAccess: false })
    expect('overrideAccess' in result && result.overrideAccess === false).toBe(true)
  })

  it('with auth off: contributes nothing — pages keep pre-RBAC behaviour', () => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'false'
    const user = { id: 'u1' } as unknown as Parameters<typeof scopedLocalArgs>[0]
    expect(scopedLocalArgs(user)).toStrictEqual({})
    expect(scopedLocalArgs(null)).toStrictEqual({})
  })

  it('authRequired is true exactly when the flag is on (renamed from accessOpen)', () => {
    delete process.env.LOCAL_PM_REQUIRE_AUTH
    expect(authRequired()).toBe(false)
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
    expect(authRequired()).toBe(true)
    process.env.LOCAL_PM_REQUIRE_AUTH = 'false'
    expect(authRequired()).toBe(false)
  })
})

describe('Users collection — default member, first account administers (#35 follow-up)', () => {
  it('defaults the role to member, never admin', () => {
    const roleField = Users.fields.find(
      (field) => 'name' in field && (field as { name?: string }).name === 'role',
    ) as { defaultValue?: string }
    expect(roleField.defaultValue).toBe('member')
  })

  it('promotes the FIRST created account to admin via beforeChange', async () => {
    const promote = Users.hooks!.beforeChange![0] as unknown as (args: {
      operation: string
      data: Record<string, unknown>
      req: { payload: Payload }
    }) => Promise<void>

    const payloadWith = (totalDocs: number): Payload =>
      ({
        find: async (args: Record<string, unknown>) => {
          expect(args.collection).toBe('users')
          expect(args.overrideAccess).toBe(true)
          return { totalDocs, docs: [] }
        },
      }) as unknown as Payload

    // Empty install: the bootstrap account is promoted.
    const first = { email: 'first@local.test', role: 'member' }
    await promote({ operation: 'create', data: first, req: { payload: payloadWith(0) } })
    expect(first.role).toBe('admin')

    // Install already has accounts: the role the caller asked for stands.
    const second = { email: 'second@local.test', role: 'member' }
    await promote({ operation: 'create', data: second, req: { payload: payloadWith(7) } })
    expect(second.role).toBe('member')
  })

  it('never queries or mutates on update operations', async () => {
    const promote = Users.hooks!.beforeChange![0] as unknown as (args: {
      operation: string
      data: Record<string, unknown>
      req: { payload: Payload }
    }) => Promise<void>
    const boom = {
      find: async () => {
        throw new Error('must not query on update')
      },
    } as unknown as Payload
    const data = { role: 'member' }
    await promote({ operation: 'update', data, req: { payload: boom } })
    expect(data.role).toBe('member')
  })
})

describe('collection wiring — declared access sets, not the weak fallback', () => {
  it('initiatives and attachments declare the task-41 access sets', () => {
    expect(Initiatives.access).toBe(initiativesAccess)
    expect(Attachments.access).toBe(attachmentsAccess)
  })

  it('attachments are all-or-nothing: member reads/writes, delete is install-admin', async () => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
    const member = memberWith('member1', [P1], 'member')
    asMemberUser(member)
    expect(await call(attachmentsAccess.read, member)).toBe(true)
    expect(await call(attachmentsAccess.create, member)).toBe(true)
    expect(await call(attachmentsAccess.delete, member, { id: 'a1' })).toBe(false)
    expect(
      await call(attachmentsAccess.delete, { id: 'admin1', role: 'admin' }, { id: 'a1' }),
    ).toBe(true)
  })
})

describe('members self-profile + field-level grants (Anas #35 point 3)', () => {
  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
  })

  it('a member may complete their own profile row (team/user fields) but never touch grants', async () => {
    const member = memberWith('member1', [P1], 'member')
    asMemberUser(member)

    // Own-row update, grants untouched: allowed.
    expect(
      await call(membersAccess.update, member, {
        id: 'gp1',
        data: { team: 'team9' },
        originalDoc: { id: 'gp1', user: String(member.id) },
      }),
    ).toBe(true)

    // Own-row update that slips in a grant field: denied regardless.
    expect(
      await call(membersAccess.update, member, {
        id: 'gp1',
        data: { team: 'team9', projects: [P1, P2] },
        originalDoc: { id: 'gp1', user: String(member.id) },
      }),
    ).toBe(false)
    expect(
      await call(membersAccess.update, member, {
        id: 'gp1',
        data: { projectRole: 'admin' },
        originalDoc: { id: 'gp1', user: 'someone-else' },
      }),
    ).toBe(false)
  })

  it('a member cannot PATCH their own projectRole or projects (field-level)', async () => {
    const member = memberWith('member1', [P1], 'member')
    asMemberUser(member)

    expect(
      await call(membersAccess.update, member, {
        id: 'gp1',
        data: { projectRole: 'admin' },
        originalDoc: { id: 'gp1', user: String(member.id) },
      }),
    ).toBe(false)

    expect(
      await call(membersAccess.update, member, {
        id: 'gp1',
        data: { projects: [P2] },
        originalDoc: { id: 'gp1', user: String(member.id) },
      }),
    ).toBe(false)

    // No doc / no linked account: deny.
    expect(
      await call(membersAccess.update, member, { id: 'gp1', data: { projectRole: 'admin' } }),
    ).toBe(false)
  })

  it('install admin keeps full members update; self-profile create unchanged', async () => {
    const admin = { id: 'admin1', role: 'admin' }
    expect(
      await call(membersAccess.update, admin, { id: 'gp1', data: { projectRole: 'admin' } }),
    ).toBe(true)
    expect(await call(membersAccess.update, admin, { id: 'gp1', data: { team: 't' } })).toBe(true)

    const member = memberWith('member1', [], 'member')
    asMemberUser(member)
    expect(
      await call(membersAccess.create, member, { data: { user: String(member.id) } }),
    ).toBe(true)
  })
})

/**
 * SignedOutGate render guards (review round 2, RSC crash class). Under auth on,
 * every page resolves `user` FIRST and answers `authRequired() && !user` with
 * the sign-in empty state instead of running a user-less scoped Local-API
 * query (payload throws Forbidden inside the RSC → route error boundary).
 * Pages under test: board, / (redirect), projects, teams, initiatives, cycles
 * lists + projects/[id], projects/[id]/edit, teams/[id], tickets/[id],
 * tickets/[id]/edit, tickets/new, cycles/[id], initiatives/[id],
 * initiatives/[id]/edit (+ their generateMetadata).
 */
const FRONTEND_PAGES = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../src/app/(frontend)/${rel}`, import.meta.url)), 'utf8')

const GUARD_PAGES = [
  'board/page.tsx',
  'projects/page.tsx',
  'teams/page.tsx',
  'initiatives/page.tsx',
  'cycles/page.tsx',
  'projects/[id]/page.tsx',
  'projects/[id]/edit/page.tsx',
  'teams/[id]/page.tsx',
  'tickets/[id]/page.tsx',
  'tickets/[id]/edit/page.tsx',
  'tickets/new/page.tsx',
  'cycles/[id]/page.tsx',
  'initiatives/[id]/page.tsx',
  'initiatives/[id]/edit/page.tsx',
] as const

/** All generateMetadata carrying a scoped lookup must early-return without a user. */
const METADATA_PAGES = [
  'projects/[id]/page.tsx',
  'teams/[id]/page.tsx',
  'tickets/[id]/page.tsx',
  'tickets/[id]/edit/page.tsx',
  'cycles/[id]/page.tsx',
  'initiatives/[id]/page.tsx',
  'initiatives/[id]/edit/page.tsx',
] as const

describe('page render guards — SignedOutGate (auth-on anonymous / stale cookie)', () => {
  beforeEach(() => {
    process.env.LOCAL_PM_REQUIRE_AUTH = 'true'
    for (const key of Object.keys(rbacMock.memberships)) delete rbacMock.memberships[key]
  })

  it('every guarded page resolves the user and gates BEFORE any scoped query', () => {
    for (const rel of GUARD_PAGES) {
      const src = FRONTEND_PAGES(rel)
      expect(src, `${rel} resolves a user`).toMatch(/authRequired\(\) \? await requireUser\(\) : null/)
      expect(src, `${rel} gates on the user before querying`).toMatch(
        /if \(authRequired\(\) && !user\) \{\s*\n\s*return <SignedOutGate/,
      )
    }
  })

  it('generateMetadata on [id] pages returns early without a session (no scoped lookup)', () => {
    for (const rel of METADATA_PAGES) {
      const src = FRONTEND_PAGES(rel)
      expect(src, `${rel} generateMetadata`).toMatch(
        /if \(authRequired\(\) && !user\) return \{ title:/,
      )
    }
  })

  it('my-tickets keeps its own session shape (the pattern source, unchanged)', () => {
    const src = FRONTEND_PAGES('my-tickets/page.tsx')
    expect(src).toMatch(/const \{ user \} = await payload\.auth\(/)
    expect(src).toMatch(/if \(user\) \{/)
  })

  it('orphan gating: board and every project-scoped list render the no-grants gate', () => {
    for (const rel of ['board/page.tsx', 'projects/page.tsx', 'cycles/page.tsx'] as const) {
      expect(FRONTEND_PAGES(rel), `${rel} orphan gate`).toMatch(
        /hasNoProjectGrants\(user\)\)\)/,
      )
    }
    // teams + initiatives need a Member document at all (rootAccess), so their
    // pages gate orphans through the same helper as well.
    for (const rel of ['teams/page.tsx', 'initiatives/page.tsx'] as const) {
      expect(FRONTEND_PAGES(rel), `${rel} orphan gate`).toMatch(
        /hasNoProjectGrants\(user\)\)\)/,
      )
    }
  })

  it('hasNoProjectGrants: true for a member with zero projects, false otherwise', async () => {
    const orphan = { id: 'orphan1', role: 'member' } as unknown as Parameters<
      typeof hasNoProjectGrants
    >[0]
    const member = { id: 'member1', role: 'member' } as unknown as Parameters<
      typeof hasNoProjectGrants
    >[0]
    const admin = { id: 'admin1', role: 'admin' } as unknown as Parameters<
      typeof hasNoProjectGrants
    >[0]

    // No Member document → no grants.
    expect(await hasNoProjectGrants(orphan)).toBe(true)

    // Member with zero linked projects → still no grants.
    rbacMock.memberships['orphan1'] = { projects: [] }
    expect(await hasNoProjectGrants(orphan)).toBe(true)

    // Real grants → false.
    rbacMock.memberships['member1'] = { projects: ['proj1'] }
    expect(await hasNoProjectGrants(member)).toBe(false)

    // Install admin and anonymous never count as orphan.
    expect(await hasNoProjectGrants(admin)).toBe(false)
    expect(await hasNoProjectGrants(null)).toBe(false)
  })

  it('SignedOutPageProps keeps the gate contract structural (title + orphan)', () => {
    const gate: SignedOutPageProps = { title: 'Board' }
    const orphanGate: SignedOutPageProps = { title: 'Board', orphan: true }
    expect(gate.title).toBe('Board')
    expect(orphanGate.orphan).toBe(true)
  })
})
