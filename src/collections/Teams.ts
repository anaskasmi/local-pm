import type { CollectionConfig } from 'payload'
import { rootAccess } from '@/lib/access'

export const Teams: CollectionConfig = {
  slug: 'teams',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'createdAt'],
    description: 'Teams group related work within a project',
  },
  access: rootAccess,
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'The name of the team',
      },
    },
    {
      name: 'description',
      type: 'richText',
      admin: {
        description: 'Brief description of the team',
      },
    },
    {
      name: 'color',
      type: 'text',
      defaultValue: '#6366f1',
      admin: {
        description: 'Color for team identification',
      },
    },
  ],
  timestamps: true,
}
