import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { LabelColor, LABEL_COLOR_OPTIONS } from '@/types/enums'
import { rootAccess } from '@/lib/access'
import { slugifyKey } from '@/lib/workflow'

export const Labels: CollectionConfig = {
  slug: 'labels',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'key', 'color', 'group'],
    description: 'Shared labels that any ticket in the workspace can carry',
  },
  access: rootAccess,
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data?.name) data.name = String(data.name).trim()
        if (data?.key) data.key = slugifyKey(String(data.key))
        else if (data?.name) data.key = slugifyKey(String(data.name))
        return data
      },
    ],
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        const key = data?.key ?? originalDoc?.key
        if (!key) return data

        const clash = await req.payload.find({
          collection: 'labels',
          depth: 0,
          limit: 1,
          where: {
            and: [
              { key: { equals: key } },
              ...(operation === 'update' && originalDoc?.id
                ? [{ id: { not_equals: originalDoc.id } }]
                : []),
            ],
          },
        })

        if (clash.docs.length > 0) {
          throw new APIError(
            `A label with the key "${key}" already exists. Rename the existing one instead of creating a second.`,
            400,
            undefined,
            true,
          )
        }

        return data
      },
    ],
    afterDelete: [
      async ({ req, id }) => {
        const tickets = await req.payload.find({
          req,
          collection: 'tickets',
          where: { labels: { equals: id } },
          limit: 1000,
          depth: 0,
          overrideAccess: true,
        })

        for (const ticket of tickets.docs) {
          const remaining = (Array.isArray(ticket.labels) ? ticket.labels : [])
            .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
            .filter((entry): entry is string => Boolean(entry) && String(entry) !== String(id))

          await req.payload.update({
            req,
            collection: 'tickets',
            id: ticket.id,
            data: { labels: remaining },
            depth: 0,
            overrideAccess: true,
          })
        }
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'What the label reads as on a card. One or two words.',
      },
    },
    {
      name: 'key',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Stable identifier used by the API and the MCP server. Derived from the name.',
      },
    },
    {
      name: 'color',
      type: 'select',
      options: LABEL_COLOR_OPTIONS,
      defaultValue: LabelColor.SLATE,
      required: true,
      admin: {
        description:
          'The swatch shown beside the name. The palette is fixed so colour stays mappable to meaning.',
      },
    },
    {
      name: 'group',
      type: 'relationship',
      relationTo: 'label-groups',
      index: true,
      admin: {
        description: 'Optional. Groups cluster related labels in the picker.',
      },
    },
    {
      name: 'description',
      type: 'text',
      admin: {
        description: 'Optional hint shown when picking this label',
      },
    },
  ],
  timestamps: true,
}
