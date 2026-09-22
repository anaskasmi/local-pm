import type { CollectionConfig, PayloadRequest } from 'payload'
import { APIError } from 'payload'
import { initiativesAccess } from '@/lib/access'
import {
  INITIATIVE_ICONS,
  INITIATIVE_STATUS_OPTIONS,
  InitiativeStatus,
  PROJECT_COLORS,
} from '@/types/enums'

export const MAX_PROJECTS_PER_INITIATIVE = 100

function idOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return id === undefined || id === null ? null : String(id)
  }
  return String(value)
}

function normaliseProjects(value: unknown): string[] | null {
  if (value === undefined) return null
  if (value === null) return []
  if (!Array.isArray(value)) {
    throw new APIError('Projects must be a list.', 400, null, true)
  }

  const seen = new Set<string>()
  for (const entry of value) {
    const id = idOf(entry)
    if (id) seen.add(id)
  }

  const ids = [...seen]
  if (ids.length > MAX_PROJECTS_PER_INITIATIVE) {
    throw new APIError(
      `An initiative can hold at most ${MAX_PROJECTS_PER_INITIATIVE} projects.`,
      400,
      null,
      true,
    )
  }
  return ids
}

async function assertProjectsExist(req: PayloadRequest, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const found = await req.payload.find({
    req,
    collection: 'projects',
    where: { id: { in: ids } },
    limit: ids.length,
    depth: 0,
    overrideAccess: true,
  })

  if (found.docs.length !== ids.length) {
    const known = new Set(found.docs.map((doc) => String(doc.id)))
    const missing = ids.filter((id) => !known.has(id))
    throw new APIError(
      `${missing.length === 1 ? 'That project' : 'Those projects'} could not be found: ${missing.join(', ')}.`,
      400,
      null,
      true,
    )
  }
}

export const Initiatives: CollectionConfig = {
  slug: 'initiatives',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'targetDate', 'createdAt'],
    description: 'A layer above projects that rolls several of them up into one objective',
  },
  access: initiativesAccess,
  hooks: {
    beforeChange: [
      async ({ data, req }) => {
        if (!data) return data

        if (typeof data.name === 'string') data.name = data.name.trim()

        const projects = normaliseProjects(data.projects)
        if (projects !== null) {
          await assertProjectsExist(req, projects)
          data.projects = projects
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
      index: true,
      admin: {
        description: 'What this initiative is trying to achieve',
      },
      validate: (value: string | null | undefined) =>
        value && value.trim() ? true : 'A name is required',
    },
    {
      name: 'description',
      type: 'richText',
      admin: {
        description: 'The objective, its scope, and how success is judged',
      },
    },
    {
      name: 'status',
      type: 'select',
      options: INITIATIVE_STATUS_OPTIONS,
      defaultValue: InitiativeStatus.PLANNED,
      required: true,
      index: true,
      admin: {
        description: 'Where this initiative sits in its life',
      },
    },
    {
      name: 'projects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
      index: true,
      admin: {
        description:
          'The projects this initiative rolls up. A project can belong to several initiatives.',
      },
    },
    {
      name: 'lead',
      type: 'relationship',
      relationTo: 'members',
      index: true,
      admin: {
        description: 'The person accountable for this initiative',
      },
    },
    {
      name: 'targetDate',
      type: 'date',
      index: true,
      admin: {
        description: 'The date this initiative is aiming at',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'icon',
      type: 'select',
      options: INITIATIVE_ICONS.map((icon) => ({ label: icon, value: icon })),
      defaultValue: 'target',
      admin: {
        description: 'Icon to represent the initiative',
      },
    },
    {
      name: 'color',
      type: 'select',
      options: PROJECT_COLORS.map((color) => ({ label: color, value: color })),
      defaultValue: '#6366f1',
      admin: {
        description: 'Colour theme for the initiative',
      },
    },
  ],
  timestamps: true,
}
