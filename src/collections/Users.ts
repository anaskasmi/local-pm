import type { CollectionConfig } from 'payload'
import { requireAuthEnabled } from '@/lib/access'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    useAPIKey: true,
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role'],
    description:
      'Login accounts and API keys. These are credentials, not assignable people — tickets are assigned to a team.',
  },
  access: {
    read: ({ req }) => (requireAuthEnabled() ? Boolean(req.user) : true),
    create: ({ req }) => {
      if (!requireAuthEnabled()) return true
      return (req.user as { role?: string } | undefined)?.role === 'admin'
    },
    update: ({ req }) => {
      if (!requireAuthEnabled()) return true
      const user = req.user as { id?: string; role?: string } | undefined
      if (!user) return false
      if (user.role === 'admin') return true
      return { id: { equals: user.id } }
    },
    delete: ({ req }) => {
      if (!requireAuthEnabled()) return true
      return (req.user as { role?: string } | undefined)?.role === 'admin'
    },
  },
  hooks: {
    beforeChange: [
      /**
       * "First account administers": the very first user document created on
       * an install is promoted to admin, so the install can be bootstrapped
       * without any pre-existing admin to grant it. Every later account
       * defaults to 'member' — an unset role field must never read as admin.
       */
      async ({ operation, req, data }) => {
        if (operation !== 'create') return
        const existing = await req.payload.find({
          collection: 'users',
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (existing.totalDocs === 0) {
          data.role = 'admin'
        }
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      admin: { description: 'Display name for this account' },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'member',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
        { label: 'Agent', value: 'agent' },
      ],
      admin: {
        description:
          'admin may delete records and manage accounts; member may read and write; agent is an automated caller and should hold an API key rather than a password. The FIRST account created is promoted to admin automatically; every later account defaults to member.',
      },
    },
  ],
  timestamps: true,
}
