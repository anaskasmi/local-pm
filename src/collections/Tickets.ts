import type { CollectionConfig, PayloadRequest } from 'payload'
import { APIError } from 'payload'
import { TicketPriority, TICKET_PRIORITY_OPTIONS } from '@/types/enums'
import { collectionAccess, requireAuthEnabled } from '@/lib/access'
import { diffTicket, idOf } from '@/lib/activity'
import { TICKET_DATES, pendingDateOrderError } from '@/lib/dates'
import { MAX_ESTIMATE, normalizeEstimate } from '@/lib/estimates'
import { changedFields, isTriageResolution, wakesSnooze } from '@/lib/triage'
import { TriageError, loadTriageQueue, resolveTriageTicket } from '@/lib/triage-service'

export const Tickets: CollectionConfig = {
  slug: 'tickets',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['ticketId', 'title', 'status', 'priority', 'project', 'assignee'],
    description: 'Individual work items within projects',
  },
  access: collectionAccess,
  endpoints: [
    {
      path: '/triage',
      method: 'get',
      handler: async (req) => {
        if (triageDenied(req)) return triageJson({ error: 'Not authorised' }, 403)

        const project = typeof req.query?.project === 'string' ? req.query.project : null
        const queue = await loadTriageQueue(req.payload, project)

        return triageJson({
          enabled: queue.statuses.length > 0,
          pending: queue.pending,
          snoozed: queue.snoozed,
          workflow: queue.workflow.map((status) => ({
            id: String(status.id),
            name: status.name,
            key: status.key,
            type: status.type,
          })),
        })
      },
    },
    {
      path: '/:id/triage',
      method: 'post',
      handler: async (req) => {
        if (triageDenied(req)) return triageJson({ error: 'Not authorised' }, 403)

        const id = req.routeParams?.id
        if (typeof id !== 'string') return triageJson({ error: 'A ticket id is required.' }, 400)

        const body = await triageBody(req)
        if (!isTriageResolution(body.resolution)) {
          return triageJson(
            { error: 'Choose one of accept, duplicate, decline or snooze.' },
            400,
          )
        }

        try {
          const outcome = await resolveTriageTicket(req, id, {
            resolution: body.resolution,
            statusId: typeof body.status === 'string' ? body.status : null,
            duplicateOf: typeof body.duplicateOf === 'string' ? body.duplicateOf : null,
            snoozedUntil: typeof body.snoozedUntil === 'string' ? body.snoozedUntil : null,
            comment: typeof body.comment === 'string' ? body.comment : null,
          })

          return triageJson({
            resolution: outcome.resolution,
            ticket: outcome.ticket,
            status: outcome.status
              ? { id: String(outcome.status.id), name: outcome.status.name }
              : null,
          })
        } catch (error) {
          if (error instanceof TriageError) {
            return triageJson({ error: error.message }, error.status)
          }
          throw error
        }
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        if (operation === 'create' && data?.project) {
          const ticketId = await generateTicketId(req, data.project as string)
          data.ticketId = ticketId
        }

        if (data?.estimate !== undefined) {
          data.estimate = normalizeEstimate(data.estimate)
        }

        if (data?.blockedBy !== undefined) {
          await assertNoDependencyCycle(req, data.blockedBy, originalDoc?.id ?? null)
        }

        if (data?.epic !== undefined || data?.isEpic !== undefined) {
          await assertValidEpicLink(req, data, originalDoc)
        }

        const dateError = pendingDateOrderError(TICKET_DATES, data, originalDoc)
        if (dateError) throw new APIError(dateError, 400, null, true)

        if (
          operation === 'update' &&
          originalDoc?.snoozedUntil &&
          wakesSnooze(changedFields(data, originalDoc))
        ) {
          data.snoozedUntil = null
        }

        if (data?.duplicateOf !== undefined) {
          assertNotSelfDuplicate(data.duplicateOf, originalDoc?.id ?? null)
        }

        return data
      },
    ],
    afterChange: [
      async ({ req, doc, previousDoc, operation }) => {
        await recordActivity(req, doc, previousDoc, operation)
      },
    ],
    afterDelete: [
      async ({ req, id }) => {
        await deleteCommentsFor(req, id)
        await deleteActivityFor(req, id)
        await detachChildrenOf(req, id)
      },
    ],
  },
  fields: [
    {
      name: 'ticketId',
      type: 'text',
      unique: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Auto-generated ticket ID (e.g., PROJ-123)',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: {
        description: 'Brief title of the ticket',
      },
    },
    {
      name: 'description',
      type: 'richText',
      admin: {
        description: 'Detailed description of the work',
      },
    },
    {
      name: 'status',
      type: 'relationship',
      relationTo: 'statuses',
      required: true,
      index: true,
      admin: {
        description: 'Current status of the ticket, drawn from its project workflow',
      },
    },
    {
      name: 'priority',
      type: 'select',
      options: TICKET_PRIORITY_OPTIONS,
      defaultValue: TicketPriority.NO_PRIORITY,
      admin: {
        description: 'Priority level of the ticket',
      },
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      required: true,
      admin: {
        description: 'The project this ticket belongs to',
      },
    },
    {
      name: 'team',
      type: 'relationship',
      relationTo: 'teams',
      admin: {
        description: 'The team responsible for this ticket',
      },
    },
    {
      name: 'cycle',
      type: 'relationship',
      relationTo: 'cycles',
      index: true,
      admin: {
        description: 'The cycle this ticket is committed to, when the project runs cycles',
      },
    },
    {
      name: 'assignee',
      type: 'relationship',
      relationTo: 'members',
      admin: {
        description: 'The person responsible for this ticket',
      },
    },
    {
      name: 'blockedBy',
      type: 'relationship',
      relationTo: 'tickets',
      hasMany: true,
      admin: {
        description: 'Tickets that must be completed before this ticket can be worked on',
      },
    },
    {
      name: 'labels',
      type: 'relationship',
      relationTo: 'labels',
      hasMany: true,
      index: true,
      admin: {
        description: 'Shared labels drawn from the workspace label set',
      },
    },
    {
      name: 'estimate',
      type: 'number',
      min: 0,
      max: MAX_ESTIMATE,
      admin: {
        description:
          'How much work this is, in points. The project picks the scale it is shown in; t-shirt sizes are stored as their point value so they still add up.',
      },
    },
    {
      name: 'startDate',
      type: 'date',
      index: true,
      admin: {
        description: 'When work on this ticket is meant to begin',
        date: {
          pickerAppearance: 'dayOnly',
        },
      },
    },
    {
      name: 'dueDate',
      type: 'date',
      index: true,
      admin: {
        description: 'When this ticket should be completed',
        date: {
          pickerAppearance: 'dayOnly',
        },
      },
    },
    {
      name: 'duplicateOf',
      type: 'relationship',
      relationTo: 'tickets',
      index: true,
      admin: {
        description:
          'The canonical ticket this one duplicates. Set when a triage item is merged into existing work.',
      },
    },
    {
      name: 'snoozedUntil',
      type: 'date',
      index: true,
      admin: {
        description: 'Hide this from the triage queue until this date, or until someone touches it',
        date: {
          pickerAppearance: 'dayOnly',
        },
      },
    },
    {
      name: 'isEpic',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description:
          'Mark this ticket as an epic so other tickets in the same project can roll up into it',
      },
    },
    {
      name: 'epic',
      type: 'relationship',
      relationTo: 'tickets',
      index: true,
      admin: {
        description:
          'The epic this ticket rolls up into. An epic and its children share a project, and epics do not nest.',
      },
    },
    {
      name: 'subtasks',
      type: 'array',
      admin: {
        description: 'Subtasks for this ticket',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
        },
        {
          name: 'completed',
          type: 'checkbox',
          defaultValue: false,
        },
      ],
    },
    {
      name: 'sortOrder',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'Order within the column',
      },
    },
  ],
  timestamps: true,
}

async function deleteCommentsFor(req: PayloadRequest, id: string | number): Promise<void> {
  await req.payload.delete({
    req,
    collection: 'comments',
    where: { ticket: { equals: id } },
    depth: 0,
  })
}

async function deleteActivityFor(req: PayloadRequest, id: string | number): Promise<void> {
  await req.payload.delete({
    req,
    collection: 'activity',
    where: { ticket: { equals: id } },
    depth: 0,
    overrideAccess: true,
  })
}

async function detachChildrenOf(req: PayloadRequest, id: string | number): Promise<void> {
  const children = await req.payload.find({
    req,
    collection: 'tickets',
    where: { epic: { equals: id } },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  for (const child of children.docs) {
    await req.payload.update({
      collection: 'tickets',
      id: child.id,
      data: { epic: null },
      depth: 0,
      overrideAccess: true,
    })
  }
}

function assertNotSelfDuplicate(duplicateOf: unknown, selfId: string | number | null): void {
  if (selfId === null) return
  const target = idOf(duplicateOf)
  if (target && target === String(selfId)) {
    throw new APIError('A ticket cannot be a duplicate of itself.', 400, null, true)
  }
}

class EpicError extends APIError {
  constructor(message: string) {
    super(message, 400, null, true)
  }
}

async function assertValidEpicLink(
  req: PayloadRequest,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined,
): Promise<void> {
  const selfId = originalDoc?.id === undefined ? null : String(originalDoc.id)
  const parentId = data.epic !== undefined ? idOf(data.epic) : idOf(originalDoc?.epic)
  const wantsEpic =
    data.isEpic !== undefined ? Boolean(data.isEpic) : Boolean(originalDoc?.isEpic)

  if (selfId && parentId === selfId) {
    throw new EpicError('A ticket cannot be its own epic.')
  }

  if (wantsEpic && parentId) {
    throw new EpicError('An epic cannot sit inside another epic. Epics are one level deep.')
  }

  if (wantsEpic === false && selfId && originalDoc?.isEpic) {
    const children = await req.payload.find({
      req,
      collection: 'tickets',
      where: { epic: { equals: selfId } },
      limit: 0,
      depth: 0,
      overrideAccess: true,
    })
    if (children.totalDocs > 0) {
      throw new EpicError(
        `This epic still has ${children.totalDocs} ticket${children.totalDocs === 1 ? '' : 's'} rolling up into it. Move them out before turning it back into a normal ticket.`,
      )
    }
  }

  if (!parentId) return

  const parent = await req.payload
    .findByID({ req, collection: 'tickets', id: parentId, depth: 0, overrideAccess: true })
    .catch(() => null)

  if (!parent) {
    throw new EpicError('That epic no longer exists.')
  }
  if (!(parent as { isEpic?: unknown }).isEpic) {
    throw new EpicError(
      'That ticket is not an epic. Mark it as an epic first, then roll tickets up into it.',
    )
  }

  const childProject = data.project !== undefined ? idOf(data.project) : idOf(originalDoc?.project)
  const parentProject = idOf((parent as { project?: unknown }).project)
  if (childProject && parentProject && childProject !== parentProject) {
    throw new EpicError('An epic and its tickets have to live in the same project.')
  }
}

async function hydrateStatus(
  req: PayloadRequest,
  record: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!record) return record
  const status = record.status
  if (!status || typeof status === 'object') return record

  try {
    const doc = await req.payload.findByID({
      req,
      collection: 'statuses',
      id: String(status),
      depth: 0,
      overrideAccess: true,
    })
    return { ...record, status: { id: doc.id, name: doc.name } }
  } catch {
    return record
  }
}

function labelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => idOf(entry)).filter((id): id is string => Boolean(id))
}

async function hydrateLabels(
  req: PayloadRequest,
  record: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!record) return record

  const ids = labelIds(record.labels)
  if (ids.length === 0) return record

  try {
    const found = await req.payload.find({
      req,
      collection: 'labels',
      where: { id: { in: ids } },
      limit: ids.length,
      depth: 0,
      overrideAccess: true,
    })
    const byId = new Map(found.docs.map((doc) => [String(doc.id), doc.name]))
    return {
      ...record,
      labels: ids.map((id) => ({ id, name: byId.get(id) ?? id })),
    }
  } catch {
    return record
  }
}

async function hydrateEpic(
  req: PayloadRequest,
  record: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!record) return record
  const epic = record.epic
  if (!epic || typeof epic === 'object') return record

  try {
    const doc = await req.payload.findByID({
      req,
      collection: 'tickets',
      id: String(epic),
      depth: 0,
      overrideAccess: true,
    })
    return { ...record, epic: { id: doc.id, title: doc.title, ticketId: doc.ticketId } }
  } catch {
    return record
  }
}

async function recordActivity(
  req: PayloadRequest,
  doc: Record<string, unknown>,
  previousDoc: Record<string, unknown> | undefined,
  operation: 'create' | 'update',
): Promise<void> {
  if (operation === 'create') {
    const created = (await hydrateLabels(req, doc)) as Record<string, unknown>
    await writeEvents(req, doc, diffTicket(null, created))
    return
  }

  const statusChanged = idOf(previousDoc?.status) !== idOf(doc.status)
  const epicChanged = idOf(previousDoc?.epic) !== idOf(doc.epic)
  const labelsChanged =
    labelIds(previousDoc?.labels).join('\u0000') !== labelIds(doc.labels).join('\u0000')

  let hydratedDoc = doc
  let hydratedPrevious = previousDoc

  if (statusChanged) {
    hydratedDoc = (await hydrateStatus(req, hydratedDoc)) as Record<string, unknown>
    hydratedPrevious = await hydrateStatus(req, hydratedPrevious)
  }
  if (epicChanged) {
    hydratedDoc = (await hydrateEpic(req, hydratedDoc)) as Record<string, unknown>
    hydratedPrevious = await hydrateEpic(req, hydratedPrevious)
  }

  if (labelsChanged) {
    hydratedDoc = (await hydrateLabels(req, hydratedDoc)) as Record<string, unknown>
    hydratedPrevious = await hydrateLabels(req, hydratedPrevious)
  }

  const events = diffTicket(hydratedPrevious, hydratedDoc)
  await writeEvents(req, doc, events)
}

async function writeEvents(
  req: PayloadRequest,
  doc: Record<string, unknown>,
  events: ReturnType<typeof diffTicket>,
): Promise<void> {
  if (events.length === 0) return

  const actor = await memberForRequest(req)

  for (const event of events) {
    await req.payload.create({
      req,
      collection: 'activity',
      depth: 0,
      overrideAccess: true,
      data: {
        ticket: doc.id as string,
        action: event.action,
        field: event.field,
        from: event.from,
        to: event.to,
        fromId: event.fromId ?? null,
        toId: event.toId ?? null,
        actor,
      },
    })
  }
}

async function memberForRequest(req: PayloadRequest): Promise<string | null> {
  const userId = req.user?.id
  if (!userId) return null

  const found = await req.payload.find({
    req,
    collection: 'members',
    where: { user: { equals: userId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const member = found.docs[0]
  return member ? String(member.id) : null
}

class CycleError extends APIError {
  constructor(message: string) {
    super(message, 400, null, true)
  }
}

async function assertNoDependencyCycle(
  req: PayloadRequest,
  blockedBy: unknown,
  selfId: string | number | null,
): Promise<void> {
  const proposed = toIdArray(blockedBy)
  if (!proposed.length) return

  if (selfId !== null && proposed.includes(String(selfId))) {
    throw new CycleError('A ticket cannot block itself.')
  }
  if (selfId === null) return

  const target = String(selfId)
  const seen = new Set<string>(proposed)
  let frontier = [...proposed]
  let hops = 0

  while (frontier.length && hops < 64) {
    hops += 1
    const docs = await req.payload.find({
      collection: 'tickets',
      where: { id: { in: frontier } },
      limit: 500,
      depth: 0,
    })

    const next: string[] = []
    for (const doc of docs.docs) {
      for (const id of toIdArray((doc as { blockedBy?: unknown }).blockedBy)) {
        if (id === target) {
          throw new CycleError(
            'That dependency would create a cycle: the ticket you are blocking on already depends on this one, directly or through other tickets.',
          )
        }
        if (!seen.has(id)) {
          seen.add(id)
          next.push(id)
        }
      }
    }
    frontier = next
  }
}

function toIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (entry === null || entry === undefined) return null
      if (typeof entry === 'string' || typeof entry === 'number') return String(entry)
      if (typeof entry === 'object' && 'id' in (entry as Record<string, unknown>)) {
        return String((entry as { id: unknown }).id)
      }
      return null
    })
    .filter((v): v is string => Boolean(v))
}

async function generateTicketId(req: PayloadRequest, projectId: string): Promise<string> {
  const model = getMongooseModel(req, 'projects')

  if (model) {
    const updated = await model.findOneAndUpdate(
      { _id: projectId },
      { $inc: { ticketCounter: 1 } },
      { new: true, returnDocument: 'after' },
    )
    if (!updated) throw new Error('Project not found')
    return `${updated.prefix}-${updated.ticketCounter}`
  }

  return generateTicketIdWithRetry(req, projectId)
}

type MinimalModel = {
  findOneAndUpdate: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<{ prefix: string; ticketCounter: number } | null>
}

function getMongooseModel(req: PayloadRequest, slug: string): MinimalModel | null {
  const collections = (req.payload.db as unknown as { collections?: Record<string, MinimalModel> })
    .collections
  const model = collections?.[slug]
  return model && typeof model.findOneAndUpdate === 'function' ? model : null
}

async function generateTicketIdWithRetry(req: PayloadRequest, projectId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const project = await req.payload.findByID({ collection: 'projects', id: projectId })
    if (!project) throw new Error('Project not found')

    const candidateCounter = (project.ticketCounter || 0) + 1
    const candidate = `${project.prefix}-${candidateCounter}`

    const clash = await req.payload.find({
      collection: 'tickets',
      where: { ticketId: { equals: candidate } },
      limit: 1,
      depth: 0,
    })

    if (clash.totalDocs === 0) {
      await req.payload.update({
        collection: 'projects',
        id: projectId,
        data: { ticketCounter: candidateCounter },
      })
      return candidate
    }
  }
  throw new Error(
    'Could not allocate a unique ticket ID after 8 attempts — check the project ticketCounter.',
  )
}

function triageDenied(req: PayloadRequest): boolean {
  return requireAuthEnabled() && !req.user
}

function triageJson(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

async function triageBody(req: PayloadRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json?.()
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
