import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { rootAccess } from '@/lib/access'
import { slugifyKey } from '@/lib/workflow'

export const LabelGroups: CollectionConfig = {
  slug: 'label-groups',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'key', 'order'],
    description: 'Optional clusters that labels can belong to, such as Area or Kind',
  },
  access: rootAccess,
  hooks: {
    beforeValidate: [
      ({ data }) => {
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
          collection: 'label-groups',
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
            `A label group with the key "${key}" already exists.`,
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
        await req.payload.update({
          req,
          collection: 'labels',
          where: { group: { equals: id } },
          data: { group: null },
          depth: 0,
          overrideAccess: true,
        })
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'The heading this group gets in the label picker',
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
      name: 'order',
      type: 'number',
      required: true,
      defaultValue: 1000,
      admin: {
        description: 'Position in the picker, ascending. Gaps are intentional.',
      },
    },
    {
      name: 'description',
      type: 'text',
      admin: {
        description: 'Optional hint shown beside the group heading',
      },
    },
  ],
  timestamps: true,
}
