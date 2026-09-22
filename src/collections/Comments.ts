import type { CollectionConfig, PayloadRequest } from 'payload'
import { APIError } from 'payload'
import { commentsAccess } from '@/lib/access'
import { extractMentionIds } from '@/lib/mentions'
import { plainSummary } from '@/lib/markdown'
import type { Activity } from '@/payload-types'

export const MAX_COMMENT_LENGTH = 10_000

export const Comments: CollectionConfig = {
  slug: 'comments',
  admin: {
    useAsTitle: 'body',
    defaultColumns: ['body', 'ticket', 'author', 'resolved'],
    description: 'Discussion on tickets. A reply points at the comment that opened the thread.',
  },
  access: commentsAccess,
  hooks: {
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        if (data?.body !== undefined) {
          const body = typeof data.body === 'string' ? data.body : ''
          if (!body.trim()) throw new APIError('A comment cannot be empty.', 400, null, true)
          if (body.length > MAX_COMMENT_LENGTH) {
            throw new APIError(
              `A comment can be at most ${MAX_COMMENT_LENGTH} characters.`,
              400,
              null,
              true,
            )
          }
          data.mentions = await resolveMentions(req, body)
          if (operation === 'update' && originalDoc && body !== originalDoc.body) {
            data.editedAt = new Date().toISOString()
          }
        }

        const parent = data?.parent ?? originalDoc?.parent
        if (data?.parent !== undefined && data.parent) {
          await assertRepliableParent(req, data.parent, data.ticket ?? originalDoc?.ticket)
        }

        if (data?.resolved && parent) {
          throw new APIError(
            'Only the comment that opened a thread can be resolved.',
            400,
            null,
            true,
          )
        }

        if (data?.resolved !== undefined && data.resolved !== originalDoc?.resolved) {
          data.resolvedAt = data.resolved ? new Date().toISOString() : null
          if (!data.resolved) data.resolvedBy = null
          else if (!data.resolvedBy) data.resolvedBy = await memberForRequest(req)
        }

        if (operation === 'create' && !data?.author) {
          data.author = await memberForRequest(req)
        }

        return data
      },
    ],
    afterChange: [
      async ({ req, doc, previousDoc, operation }) => {
        await recordCommentActivity(req, doc, previousDoc, operation)
      },
    ],
    afterDelete: [
      async ({ req, id, doc }) => {
        await recordCommentDeleted(req, doc)
        await req.payload.delete({
          req,
          collection: 'comments',
          where: { parent: { equals: id } },
          depth: 0,
        })
      },
    ],
  },
  fields: [
    {
      name: 'ticket',
      type: 'relationship',
      relationTo: 'tickets',
      required: true,
      index: true,
      admin: {
        description: 'The ticket this comment belongs to',
      },
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'comments',
      index: true,
      admin: {
        description:
          'The comment that opened this thread. Empty for a top-level comment. Threads are one level deep.',
      },
    },
    {
      name: 'body',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'Markdown. Mentions are stored as @[Name](member:ID) and render as a chip.',
      },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'members',
      admin: {
        description:
          'Who wrote this. Filled from the signed-in account when the caller does not set it.',
      },
    },
    {
      name: 'mentions',
      type: 'relationship',
      relationTo: 'members',
      hasMany: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Derived from the body on every save. Do not edit by hand.',
      },
    },
    {
      name: 'resolved',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'A resolved thread collapses. Only the first comment in a thread carries it.',
      },
    },
    {
      name: 'resolvedAt',
      type: 'date',
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'resolvedBy',
      type: 'relationship',
      relationTo: 'members',
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'editedAt',
      type: 'date',
      admin: { position: 'sidebar', readOnly: true },
    },
  ],
  timestamps: true,
}

async function assertRepliableParent(
  req: PayloadRequest,
  parent: unknown,
  ticket: unknown,
): Promise<void> {
  const parentId = toId(parent)
  if (!parentId) return

  let doc: { parent?: unknown; ticket?: unknown } | null = null
  try {
    doc = (await req.payload.findByID({
      req,
      collection: 'comments',
      id: parentId,
      depth: 0,
    })) as { parent?: unknown; ticket?: unknown }
  } catch {
    doc = null
  }

  if (!doc) throw new APIError('That comment no longer exists.', 400, null, true)

  if (toId(doc.parent)) {
    throw new APIError(
      'Replies go on the comment that opened the thread, not on another reply.',
      400,
      null,
      true,
    )
  }

  const ticketId = toId(ticket)
  if (ticketId && toId(doc.ticket) !== ticketId) {
    throw new APIError('A reply must sit on the same ticket as the comment it answers.', 400, null, true)
  }
}

async function resolveMentions(req: PayloadRequest, body: string): Promise<string[]> {
  const ids = extractMentionIds(body)
  if (ids.length === 0) return []

  const found = await req.payload.find({
    req,
    collection: 'members',
    where: { id: { in: ids } },
    limit: ids.length,
    depth: 0,
  })

  const live = new Set(found.docs.map((doc) => String(doc.id)))
  return ids.filter((id) => live.has(id))
}

interface ActivityInput {
  ticket: string
  action: NonNullable<Activity['action']>
  comment?: string | null
  from?: string | null
  to?: string | null
  actor?: string | null
}

async function writeActivity(req: PayloadRequest, data: ActivityInput): Promise<void> {
  await req.payload.create({
    req,
    collection: 'activity',
    depth: 0,
    overrideAccess: true,
    data,
  })
}

async function recordCommentActivity(
  req: PayloadRequest,
  doc: Record<string, unknown>,
  previousDoc: Record<string, unknown> | undefined,
  operation: 'create' | 'update',
): Promise<void> {
  const ticket = toId(doc.ticket)
  if (!ticket) return

  const summary = plainSummary(typeof doc.body === 'string' ? doc.body : '', 140)

  if (operation === 'create') {
    await writeActivity(req, {
      ticket,
      action: toId(doc.parent) ? 'replied' : 'commented',
      comment: String(doc.id),
      to: summary,
      actor: toId(doc.author) ?? (await memberForRequest(req)),
    })
    return
  }

  if (!previousDoc) return

  const actor = await memberForRequest(req)

  if (Boolean(doc.resolved) !== Boolean(previousDoc.resolved)) {
    await writeActivity(req, {
      ticket,
      action: doc.resolved ? 'resolved' : 'reopened',
      comment: String(doc.id),
      to: summary,
      actor: toId(doc.resolvedBy) ?? actor,
    })
  }

  if (typeof doc.body === 'string' && doc.body !== previousDoc.body) {
    await writeActivity(req, {
      ticket,
      action: 'edited',
      comment: String(doc.id),
      from: plainSummary(typeof previousDoc.body === 'string' ? previousDoc.body : '', 140),
      to: summary,
      actor: toId(doc.author) ?? actor,
    })
  }
}

async function recordCommentDeleted(
  req: PayloadRequest,
  doc: Record<string, unknown> | undefined,
): Promise<void> {
  const ticket = doc ? toId(doc.ticket) : null
  if (!doc || !ticket) return

  await writeActivity(req, {
    ticket,
    action: 'deleted',
    from: plainSummary(typeof doc.body === 'string' ? doc.body : '', 140),
    actor: await memberForRequest(req),
  })
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
  })
  const member = found.docs[0]
  return member ? String(member.id) : null
}

function toId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }
  return null
}
