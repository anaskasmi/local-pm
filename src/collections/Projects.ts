import type { CollectionConfig, PayloadRequest } from 'payload'
import { APIError } from 'payload'
import {
  ProjectStatus,
  StatusType,
  PROJECT_STATUS_OPTIONS,
  PROJECT_ICONS,
  PROJECT_COLORS,
  CycleAutomation,
  CycleRollover,
  CYCLE_AUTOMATION_OPTIONS,
  CYCLE_ROLLOVER_OPTIONS,
  ESTIMATE_SCALE_OPTIONS,
} from '@/types/enums'
import { collectionAccess } from '@/lib/access'
import { PROJECT_DATES, pendingDateOrderError } from '@/lib/dates'
import {
  DECLINED_STATUS_KEY,
  DECLINED_STATUS_NAME,
  DECLINED_STATUS_ORDER,
  TRIAGE_STATUS_KEY,
  TRIAGE_STATUS_NAME,
  TRIAGE_STATUS_ORDER,
} from '@/lib/triage'
import { DEFAULT_ESTIMATE_SCALE } from '@/lib/estimates'
import {
  DEFAULT_CYCLE_LENGTH_WEEKS,
  DEFAULT_CYCLE_START_DAY,
  DEFAULT_UPCOMING_CYCLES,
  MAX_CYCLE_LENGTH_WEEKS,
  MAX_UPCOMING_CYCLES,
  MIN_CYCLE_LENGTH_WEEKS,
} from '@/lib/cycles'

async function detachFromInitiatives(req: PayloadRequest, id: string | number): Promise<void> {
  const target = String(id)

  const holders = await req.payload.find({
    req,
    collection: 'initiatives',
    where: { projects: { in: [target] } },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  for (const initiative of holders.docs) {
    const remaining = (initiative.projects ?? [])
      .map((entry) => (typeof entry === 'object' ? String(entry.id) : String(entry)))
      .filter((projectId) => projectId !== target)

    await req.payload.update({
      collection: 'initiatives',
      id: initiative.id,
      data: { projects: remaining },
      depth: 0,
      overrideAccess: true,
    })
  }
}

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'prefix', 'status', 'createdAt'],
    description: 'Projects organize related tickets together',
  },
  access: collectionAccess,
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        const dateError = pendingDateOrderError(PROJECT_DATES, data, originalDoc)
        if (dateError) throw new APIError(dateError, 400, null, true)
        return data
      },
    ],
    afterChange: [
      async ({ req, doc, previousDoc, operation }) => {
        const wanted = Boolean((doc as { triage?: { enabled?: unknown } }).triage?.enabled)
        const had =
          operation === 'update' &&
          Boolean((previousDoc as { triage?: { enabled?: unknown } })?.triage?.enabled)
        if (wanted && !had) {
          await ensureTriageStatus(req, doc.id)
          await ensureDeclinedStatus(req, doc.id)
        }
      },
    ],
    afterDelete: [
      async ({ req, id }) => {
        await detachFromInitiatives(req, id)
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'The name of the project',
      },
    },
    {
      name: 'prefix',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'Short prefix for ticket IDs (e.g., PROJ for PROJ-123)',
      },
      validate: (value: string | null | undefined) => {
        if (!value) return 'Prefix is required'
        if (!/^[A-Z]{2,6}$/.test(value)) {
          return 'Prefix must be 2-6 uppercase letters'
        }
        return true
      },
    },
    {
      name: 'description',
      type: 'richText',
      admin: {
        description: 'Detailed description of the project',
      },
    },
    {
      name: 'icon',
      type: 'select',
      options: PROJECT_ICONS.map((icon) => ({ label: icon, value: icon })),
      defaultValue: 'folder',
      admin: {
        description: 'Icon to represent the project',
      },
    },
    {
      name: 'color',
      type: 'select',
      options: PROJECT_COLORS.map((color) => ({ label: color, value: color })),
      defaultValue: '#6366f1',
      admin: {
        description: 'Color theme for the project',
      },
    },
    {
      name: 'status',
      type: 'select',
      options: PROJECT_STATUS_OPTIONS,
      defaultValue: ProjectStatus.ACTIVE,
      required: true,
      admin: {
        description: 'Current status of the project',
      },
    },
    {
      name: 'startDate',
      type: 'date',
      index: true,
      admin: {
        description: 'When work on this project is meant to begin',
        date: {
          pickerAppearance: 'dayOnly',
        },
      },
    },
    {
      name: 'targetDate',
      type: 'date',
      index: true,
      admin: {
        description: 'The date this project is aiming to finish by',
        date: {
          pickerAppearance: 'dayOnly',
        },
      },
    },
    {
      name: 'cycles',
      type: 'group',
      admin: {
        description: 'Time-boxed cycles for this project',
      },
      fields: [
        {
          name: 'enabled',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description: 'Turn cycles on for this project. Off by default.',
          },
        },
        {
          name: 'lengthWeeks',
          type: 'number',
          defaultValue: DEFAULT_CYCLE_LENGTH_WEEKS,
          min: MIN_CYCLE_LENGTH_WEEKS,
          max: MAX_CYCLE_LENGTH_WEEKS,
          admin: {
            description: 'How long each cycle runs. Applies to cycles created from now on.',
          },
        },
        {
          name: 'startDay',
          type: 'number',
          defaultValue: DEFAULT_CYCLE_START_DAY,
          min: 0,
          max: 6,
          admin: {
            description: 'Weekday the first cycle starts on, 0 being Sunday',
          },
        },
        {
          name: 'rollover',
          type: 'select',
          options: CYCLE_ROLLOVER_OPTIONS,
          defaultValue: CycleRollover.NEXT,
          admin: {
            description: 'Where incomplete tickets go when a cycle closes',
          },
        },
        {
          name: 'automation',
          type: 'select',
          options: CYCLE_AUTOMATION_OPTIONS,
          defaultValue: CycleAutomation.AUTOMATIC,
          admin: {
            description:
              'Automatic closes elapsed cycles on the server on a schedule. Manual waits for someone to close each cycle.',
          },
        },
        {
          name: 'upcomingCount',
          type: 'number',
          defaultValue: DEFAULT_UPCOMING_CYCLES,
          min: 0,
          max: MAX_UPCOMING_CYCLES,
          admin: {
            description: 'How many future cycles to keep provisioned ahead of the active one',
          },
        },
      ],
    },
    {
      name: 'triage',
      type: 'group',
      admin: {
        description: 'A holding queue for incoming work, reviewed before it reaches the backlog',
      },
      fields: [
        {
          name: 'enabled',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description:
              'Turn triage on for this project. Off by default. Enabling it adds a Triage status that the board and list views leave out.',
          },
        },
      ],
    },
    {
      name: 'estimates',
      type: 'group',
      admin: {
        description: 'Effort estimates for tickets in this project',
      },
      fields: [
        {
          name: 'enabled',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description:
              'Turn estimates on for this project. Off by default, and cycle charts count tickets instead.',
          },
        },
        {
          name: 'scale',
          type: 'select',
          options: ESTIMATE_SCALE_OPTIONS,
          defaultValue: DEFAULT_ESTIMATE_SCALE,
          admin: {
            description:
              'How estimates are written. Changing it relabels existing estimates without rewriting them.',
          },
        },
      ],
    },
    {
      name: 'ticketCounter',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Auto-incremented counter for ticket IDs',
      },
    },
  ],
  timestamps: true,
}

async function ensureTriageStatus(req: PayloadRequest, projectId: string | number): Promise<void> {
  const existing = await req.payload.find({
    req,
    collection: 'statuses',
    where: {
      and: [{ key: { equals: TRIAGE_STATUS_KEY } }, { project: { equals: String(projectId) } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.totalDocs > 0) return

  await req.payload.create({
    req,
    collection: 'statuses',
    depth: 0,
    overrideAccess: true,
    data: {
      name: TRIAGE_STATUS_NAME,
      key: TRIAGE_STATUS_KEY,
      type: StatusType.TRIAGE,
      order: TRIAGE_STATUS_ORDER,
      project: String(projectId),
      description: 'Incoming work waiting to be accepted, declined or merged',
    },
  })
}

async function ensureDeclinedStatus(req: PayloadRequest, projectId: string | number): Promise<void> {
  const existing = await req.payload.find({
    req,
    collection: 'statuses',
    where: {
      and: [
        { type: { equals: StatusType.CANCELLED } },
        {
          or: [{ project: { equals: String(projectId) } }, { project: { exists: false } }],
        },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.totalDocs > 0) return

  await req.payload.create({
    req,
    collection: 'statuses',
    depth: 0,
    overrideAccess: true,
    data: {
      name: DECLINED_STATUS_NAME,
      key: DECLINED_STATUS_KEY,
      type: StatusType.CANCELLED,
      order: DECLINED_STATUS_ORDER,
      project: String(projectId),
      description: 'Work that was declined in triage, or cancelled after it was accepted',
    },
  })
}
