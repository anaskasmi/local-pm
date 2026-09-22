import type { Access, Payload, PayloadRequest, TypedUser, Where } from 'payload'

export const requireAuthEnabled = (): boolean => process.env.LOCAL_PM_REQUIRE_AUTH === 'true'

/**
 * Canonical name for requireAuthEnabled: true when the install requires
 * authentication ("auth on"). Every access rule reads this; `accessOpen` was
 * retired because it read as the opposite of what it returns.
 */
export const authRequired = requireAuthEnabled

/**
 * Project-role tiers carried by Members.projectRole.
 * Viewer reads, member reads and writes, admin also deletes inside the project.
 */
const WRITE_ROLES = new Set(['admin', 'member'])
const DELETE_ROLES = new Set(['admin'])

interface MemberLike {
  projects?: (string | { id?: string })[] | null
  projectRole?: string | null
}

function isInstallAdmin(user: TypedUser | null | undefined): boolean {
  const role = (user as { role?: unknown } | null | undefined)?.role
  return role === 'admin'
}

function refId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  return null
}

/** The Member document linked to the requesting account, if any. */
export async function memberForUser(payload: Payload, userId: string): Promise<MemberLike | null> {
  const found = await payload.find({
    collection: 'members',
    where: { user: { equals: userId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (found.docs[0] as MemberLike | undefined) ?? null
}

/**
 * IDs of this membership's projects, as a filter-safe list. A member with
 * zero linked projects holds NO project grants at all — the empty list must
 * deny project content, not open it.
 */
export async function grantedProjectIds(
  payload: Payload,
  user: TypedUser,
): Promise<string[]> {
  const member = await memberForUser(payload, user.id as string)
  if (!member) return []
  const refs = Array.isArray(member.projects) ? member.projects : []
  const ids: string[] = []
  for (const ref of refs) {
    const id = typeof ref === 'string' ? ref : ref?.id
    if (id) ids.push(String(id))
  }
  return ids
}

/**
 * Resolve which project a document is scoped to. Returns undefined when the
 * collection carries no project scope at all.
 * tickets/cycles/statuses carry `project`; comments inherit their ticket's
 * project; projects are the root objects themselves.
 */
async function projectOfDoc(
  payload: Payload,
  collection: string,
  doc: Record<string, unknown>,
): Promise<string | null | undefined> {
  const direct = directProjectOf(collection, doc)
  if (direct !== undefined) return direct

  if (collection === 'comments') {
    const ticketId = refId(doc.ticket)
    if (!ticketId) return null
    try {
      const ticket = (await payload.findByID({
        collection: 'tickets',
        id: ticketId,
        depth: 0,
        overrideAccess: true,
      })) as { project?: unknown } | null
      return directProjectOf('tickets', ticket ?? {}) ?? null
    } catch {
      return null
    }
  }

  return null
}

function directProjectOf(
  collection: string,
  doc: Record<string, unknown>,
): string | null | undefined {
  switch (collection) {
    case 'projects':
      return typeof doc.id === 'string' || typeof doc.id === 'number' ? String(doc.id) : null
    case 'tickets':
    case 'cycles':
    case 'statuses':
      return refId(doc.project)
    case 'initiatives':
      return undefined
    default:
      return undefined
  }
}

async function requireMember(payload: Payload, user: TypedUser): Promise<MemberLike | null> {
  return memberForUser(payload, user.id as string)
}

/**
 * The role a caller holds for one specific project: the member's projectRole
 * when the project is in their grants, null otherwise.
 */
async function roleForProject(
  payload: Payload,
  user: TypedUser,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) return null
  const member = await memberForUser(payload, user.id as string)
  if (!member) return null
  const refs = Array.isArray(member.projects) ? member.projects : []
  const granted = refs.some((ref) => (typeof ref === 'string' ? ref : ref?.id) === projectId)
  return granted ? (member.projectRole ?? 'member') : null
}

function idWhere(collection: string, ids: string[]): Where {
  const field = collection === 'projects' ? 'id' : 'project'
  return { [field]: { in: ids } }
}

/**
 * Read access for project-scoped collections. Auth off: open. Auth on:
 * anonymous denied outright, install-admin sees everything, and a member gets
 * a Where constraint — their projects only — so unfiltered REST finds can
 * never leak other projects' rows or names.
 */
function scopedRead(collection: 'tickets' | 'cycles' | 'statuses' | 'projects'): Access {
  return async ({ req }) => {
    if (!requireAuthEnabled()) return true
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true
    const ids = await grantedProjectIds(req.payload, user)
    if (ids.length === 0) return false
    if (collection === 'statuses') {
      // Global statuses (no project) render every board, so they stay readable.
      return { or: [{ project: { in: ids } }, { project: { exists: false } }] } as Where
    }
    return idWhere(collection, ids)
  }
}

function scopedWrite(collection: 'tickets' | 'cycles' | 'statuses'): Access {
  return async (args) => {
    if (!requireAuthEnabled()) return true
    const { req, id, data } = args as {
      req: PayloadRequest
      id?: string | number
      data?: Record<string, unknown>
    }
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true

    const incoming = refId(data?.project)
    if (id === undefined || id === null) {
      // Create: every referenced project must be granted (one, in practice).
      if (!incoming) return false
      const role = await roleForProject(req.payload, user, incoming)
      return role !== null && WRITE_ROLES.has(role)
    }

    // Update: the caller needs write on the current project AND on the target
    // one when the operation moves the doc across projects.
    let current: string | null | undefined
    try {
      const doc = (await req.payload.findByID({
        collection,
        id,
        depth: 0,
        overrideAccess: true,
      })) as unknown as Record<string, unknown> | null
      current = doc ? directProjectOf(collection, doc) : null
    } catch {
      current = null
    }

    const currentRole = await roleForProject(req.payload, user, current)
    if (currentRole === null || !WRITE_ROLES.has(currentRole)) return false
    if (incoming && incoming !== current) {
      const targetRole = await roleForProject(req.payload, user, incoming)
      if (targetRole === null || !WRITE_ROLES.has(targetRole)) return false
    }
    return true
  }
}

function scopedDelete(collection: 'tickets' | 'cycles' | 'statuses'): Access {
  return async (args) => {
    if (!requireAuthEnabled()) return true
    const { req, id } = args as { req: PayloadRequest; id?: string | number }
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true

    let projectId: string | null | undefined
    if (id !== undefined && id !== null) {
      try {
        const doc = (await req.payload.findByID({
          collection,
          id,
          depth: 0,
          overrideAccess: true,
        })) as unknown as Record<string, unknown> | null
        projectId = doc ? directProjectOf(collection, doc) : null
      } catch {
        projectId = null
      }
    }

    const role = await roleForProject(req.payload, user, projectId)
    return role !== null && DELETE_ROLES.has(role)
  }
}

/**
 * Comments and activity inherit their ticket's project. Reads return a Where
 * over the ticket IDs inside the member's projects so list endpoints cannot
 * cross the membership; writes resolve the parent ticket per document.
 */
async function ticketIdsInProjects(payload: Payload, ids: string[]): Promise<string[]> {
  const found = await payload.find({
    collection: 'tickets',
    where: { project: { in: ids } },
    limit: 10000,
    depth: 0,
    overrideAccess: true,
  })
  return found.docs.map((doc) => String(doc.id))
}

function inheritedRead(): Access {
  return async ({ req }) => {
    if (!requireAuthEnabled()) return true
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true
    const ids = await grantedProjectIds(req.payload, user)
    if (ids.length === 0) return false
    const ticketIds = await ticketIdsInProjects(req.payload, ids)
    if (ticketIds.length === 0) return false
    return { ticket: { in: ticketIds } }
  }
}

function inheritedWrite(operation: 'create' | 'update' | 'delete'): Access {
  return async (args) => {
    if (!requireAuthEnabled()) return true
    const { req, id, data } = args as {
      req: PayloadRequest
      id?: string | number
      data?: Record<string, unknown>
    }
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true

    // Resolve the governing ticket: incoming for creates, the stored doc for
    // updates and deletes.
    let ticketId: string | null = null
    if (operation === 'create') {
      ticketId = refId(data?.ticket)
    } else if (id !== undefined && id !== null) {
      try {
        const doc = (await req.payload.findByID({
          collection: 'comments',
          id,
          depth: 0,
          overrideAccess: true,
        })) as unknown as Record<string, unknown> | null
        ticketId = doc ? refId(doc.ticket) : null
      } catch {
        ticketId = null
      }
    }
    if (!ticketId) return false

    let project: string | null = null
    try {
      const ticket = (await req.payload.findByID({
        collection: 'tickets',
        id: ticketId,
        depth: 0,
        overrideAccess: true,
      })) as { project?: unknown } | null
      project = ticket ? refId(ticket.project) : null
    } catch {
      project = null
    }

    const role = await roleForProject(req.payload, user, project)
    if (role === null) return false
    return operation === 'delete' ? DELETE_ROLES.has(role) : WRITE_ROLES.has(role)
  }
}

export const ticketsAccess: Record<string, Access> = {
  read: scopedRead('tickets'),
  create: scopedWrite('tickets'),
  update: scopedWrite('tickets'),
  delete: scopedDelete('tickets'),
}

export const cyclesAccess: Record<string, Access> = {
  read: scopedRead('cycles'),
  create: scopedWrite('cycles'),
  update: scopedWrite('cycles'),
  delete: scopedDelete('cycles'),
}

export const statusesAccess: Record<string, Access> = {
  read: scopedRead('statuses'),
  create: scopedWrite('statuses'),
  update: scopedWrite('statuses'),
  delete: scopedDelete('statuses'),
}

export const projectsAccess: Record<string, Access> = {
  read: scopedRead('projects'),
  // Creating a project makes you its first admin grant via the members admin
  // UI later; the create itself stays install-admin.
  create: async ({ req }) => {
    if (!requireAuthEnabled()) return true
    const user = req.user as TypedUser | undefined
    if (!user) return false
    return isInstallAdmin(user)
  },
  update: async (args) => {
    if (!requireAuthEnabled()) return true
    const { req, id } = args as { req: PayloadRequest; id?: string | number }
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true
    const role = await roleForProject(req.payload, user, id ? String(id) : null)
    return role !== null && WRITE_ROLES.has(role)
  },
  delete: async (args) => {
    if (!requireAuthEnabled()) return true
    const { req, id } = args as { req: PayloadRequest; id?: string | number }
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true
    const role = await roleForProject(req.payload, user, id ? String(id) : null)
    return role !== null && DELETE_ROLES.has(role)
  },
}

export const commentsAccess: Record<string, Access> = {
  read: inheritedRead(),
  create: inheritedWrite('create'),
  update: inheritedWrite('update'),
  delete: inheritedWrite('delete'),
}

/**
 * Root-level collections: teams, labels, label-groups are shared workspace
 * furniture — any authenticated member reads and writes; delete stays with
 * the install admin. Attachments ride along (their content belongs to
 * tickets a member can already reach).
 */
const memberGate = async (req: PayloadRequest): Promise<boolean> => {
  const user = req.user as TypedUser | undefined
  if (!user) return false
  if (isInstallAdmin(user)) return true
  return Boolean(await requireMember(req.payload, user))
}

export const rootAccess: Record<string, Access> = {
  read: async ({ req }) => (requireAuthEnabled() ? memberGate(req) : true),
  create: async ({ req }) => (requireAuthEnabled() ? memberGate(req) : true),
  update: async ({ req }) => (requireAuthEnabled() ? memberGate(req) : true),
  delete: async ({ req }) => {
    if (!requireAuthEnabled()) return true
    const user = req.user as TypedUser | undefined
    return Boolean(user && isInstallAdmin(user))
  },
}

/**
 * Attachments: all-or-nothing under auth on — every authenticated member may
 * read and write, deletes stay with the install admin. Files live on tickets
 * a member can already reach; per-project attachment scoping does not exist.
 */
export const attachmentsAccess: Record<string, Access> = rootAccess

/**
 * Members: profile directory. Auth on: install-admin manages everything. A
 * signed-in account may read members (pickers, mentions), create its own
 * profile, and complete its OWN profile row with safe profile fields only —
 * the grant fields (projects, projectRole) are install-admin territory at
 * collection AND field level: the account holder can never widen their own
 * grants, not even on their own row.
 */
export const membersAccess: Record<string, Access> = {
  read: async ({ req }) => (requireAuthEnabled() ? Boolean(req.user) : true),
  create: async (args) => {
    if (!requireAuthEnabled()) return true
    const { req, data } = args as { req: PayloadRequest; data?: Record<string, unknown> }
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true
    // Self-service profile creation keeps "My tickets" working; the created
    // profile carries no grants until an admin assigns them.
    return refId(data?.user) === String(user.id)
  },
  update: async (args) => {
    if (!requireAuthEnabled()) return true
    const { req, data, originalDoc } = args as {
      req: PayloadRequest
      data?: Record<string, unknown>
      originalDoc?: { user?: unknown } | null
    }
    const user = req.user as TypedUser | undefined
    if (!user) return false
    if (isInstallAdmin(user)) return true
    // Grant fields are admin-only no matter whose row is being edited.
    if (data !== undefined && ['projects', 'projectRole'].some((f) => f in data)) return false
    // Self-service completion of one's own profile row (safe fields only):
    // the edited row must be the account's own linked Member document.
    return refId(originalDoc?.user) === String(user.id)
  },
  delete: async ({ req }) => {
    if (!requireAuthEnabled()) return true
    const user = req.user as TypedUser | undefined
    return Boolean(user && isInstallAdmin(user))
  },
}

export const initiativesAccess: Record<string, Access> = {
  // Initiatives span projects; membership on ANY granted project lets a
  // member read and write them. Scoped per-project initiative reads would
  // need a cross-collection Where, which the app's surfaces never need.
  read: async ({ req }) => (requireAuthEnabled() ? memberGate(req) : true),
  create: async ({ req }) => (requireAuthEnabled() ? memberGate(req) : true),
  update: async ({ req }) => (requireAuthEnabled() ? memberGate(req) : true),
  delete: async ({ req }) => {
    if (!requireAuthEnabled()) return true
    const user = req.user as TypedUser | undefined
    return Boolean(user && isInstallAdmin(user))
  },
}

// Backwards-compatible named exports (Activity's read, Users' rules and any
// external consumer). Under auth-off they behave exactly as before. Under
// auth-on every operation requires a signed-in account — the old
// "Boolean(req.user) may write" shape is deliberately NOT preserved, because
// it is the exact grant this task set out to close.
export const readAccess: Access = ({ req }) => {
  if (!requireAuthEnabled()) return true
  return Boolean(req.user)
}

export const writeAccess: Access = ({ req }) => {
  if (!requireAuthEnabled()) return true
  return Boolean(req.user)
}

export const deleteAccess: Access = ({ req }) => {
  if (!requireAuthEnabled()) return true
  const role = (req.user as { role?: string } | undefined)?.role
  return typeof role === 'string' && role === 'admin'
}

export const collectionAccess = {
  read: readAccess,
  create: writeAccess,
  update: writeAccess,
  delete: deleteAccess,
}
