import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { StatusType, STATUS_TYPE_OPTIONS } from '@/types/enums'
import { statusesAccess } from '@/lib/access'
import { slugifyKey } from '@/lib/workflow'

export const Statuses: CollectionConfig = {
  slug: 'statuses',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'key', 'type', 'project', 'order'],
    description: 'Workflow states a ticket can occupy, globally or per project',
  },
  access: statusesAccess,
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
        const project = data?.project !== undefined ? data.project : originalDoc?.project
        if (!key) return data

        const clash = await req.payload.find({
          collection: 'statuses',
          depth: 0,
          limit: 1,
          where: {
            and: [
              { key: { equals: key } },
              project
                ? { project: { equals: typeof project === 'object' ? project.id : project } }
                : { project: { exists: false } },
              ...(operation === 'update' && originalDoc?.id
                ? [{ id: { not_equals: originalDoc.id } }]
                : []),
            ],
          },
        })

        if (clash.docs.length > 0) {
          throw new APIError(
            `A status with the key "${key}" already exists in this workflow.`,
            400,
            undefined,
            true,
          )
        }

        return data
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'The label shown on the board column and on tickets',
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
      name: 'type',
      type: 'select',
      options: STATUS_TYPE_OPTIONS,
      defaultValue: StatusType.UNSTARTED,
      required: true,
      index: true,
      admin: {
        description:
          'The semantic category. Drives the icon, the tone, and whether a ticket counts as open or closed.',
      },
    },
    {
      name: 'order',
      type: 'number',
      required: true,
      defaultValue: 1000,
      admin: {
        description: 'Column position, ascending. Gaps are intentional so a status can be inserted.',
      },
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      index: true,
      admin: {
        description: 'Leave empty for a workspace-wide status. Set it to scope the status to one project.',
      },
    },
    {
      name: 'description',
      type: 'text',
      admin: {
        description: 'Optional hint shown when picking this status',
      },
    },
  ],
  timestamps: true,
}
