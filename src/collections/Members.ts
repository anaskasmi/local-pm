import type { CollectionConfig, PayloadRequest } from 'payload'
import { APIError } from 'payload'
import { membersAccess } from '@/lib/access'

export const Members: CollectionConfig = {
  slug: 'members',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'team', 'active'],
    description: 'People that tickets can be assigned to.',
  },
  access: membersAccess,
  hooks: {
    beforeChange: [
      async ({ data, req, originalDoc }) => {
        if (data?.user !== undefined) {
          await assertUserNotAlreadyLinked(req, data.user, originalDoc?.id ?? null)
        }
        return data
      },
    ],
    afterDelete: [
      async ({ req, id }) => {
        await clearAssignmentsFor(req, id)
        await clearCommentTracesFor(req, id)
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name — what shows on cards and in pickers',
      },
    },
    {
      name: 'email',
      type: 'email',
      admin: {
        description: 'Optional. Used to tell two people with the same name apart.',
      },
    },
    {
      name: 'team',
      type: 'relationship',
      relationTo: 'teams',
      admin: {
        description: 'The team this person belongs to',
      },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description:
          'Inactive people keep their existing assignments but drop out of the assignee pickers.',
      },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        description:
          'The login account this person signs in with. Set it and "My tickets" works for them.',
      },
    },
    {
      name: 'projects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
      admin: {
        position: 'sidebar',
        description:
          'Projects this person can open. Empty means no project access; only admins of the install see everything.',
      },
    },
    {
      name: 'projectRole',
      type: 'select',
      defaultValue: 'member',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
        { label: 'Viewer', value: 'viewer' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'What this person can do inside their projects. Viewer reads, member also writes, admin also deletes. Ignored outside the projects above.',
      },
    },
  ],
  timestamps: true,
}

async function clearCommentTracesFor(req: PayloadRequest, id: string | number): Promise<void> {
  await req.payload.update({
    req,
    collection: 'comments',
    where: { author: { equals: id } },
    data: { author: null },
    depth: 0,
  })
  const mentioning = await req.payload.find({
    req,
    collection: 'comments',
    where: { mentions: { equals: id } },
    limit: 1000,
    depth: 0,
  })

  for (const doc of mentioning.docs) {
    await req.payload.update({
      req,
      collection: 'comments',
      id: doc.id,
      data: { body: doc.body },
      depth: 0,
    })
  }
}

async function clearAssignmentsFor(req: PayloadRequest, id: string | number): Promise<void> {
  await req.payload.update({
    req,
    collection: 'tickets',
    where: { assignee: { equals: id } },
    data: { assignee: null },
    depth: 0,
  })
}

async function assertUserNotAlreadyLinked(
  req: PayloadRequest,
  user: unknown,
  selfId: string | number | null,
): Promise<void> {
  const userId = toId(user)
  if (!userId) return

  const existing = await req.payload.find({
    req,
    collection: 'members',
    where: { user: { equals: userId } },
    limit: 1,
    depth: 0,
  })

  const clash = existing.docs.find((doc) => String(doc.id) !== String(selfId ?? ''))
  if (clash) {
    throw new APIError(
      `That account is already linked to ${clash.name}. Unlink it there first.`,
      400,
      null,
      true,
    )
  }
}

function toId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }
  return null
}
