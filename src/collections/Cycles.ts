import type { CollectionConfig, PayloadRequest } from 'payload'
import { APIError } from 'payload'
import type { Cycle, Project } from '@/payload-types'
import { cyclesAccess, requireAuthEnabled } from '@/lib/access'
import { closeCycleNow, reconcileAllProjects, reconcileProjectCycles } from '@/lib/cycle-service'
import { loadBurndown, loadVelocity, snapshotOf } from '@/lib/burndown-service'
import { defaultCycleName, toIsoDate } from '@/lib/cycles'

function denied(req: PayloadRequest): boolean {
  return requireAuthEnabled() && !req.user
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

async function readBody(req: PayloadRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json?.()
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const Cycles: CollectionConfig = {
  slug: 'cycles',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'number', 'project', 'startsAt', 'endsAt', 'completedAt'],
    description: 'Time-boxed cycles that incomplete work rolls out of when they end',
  },
  access: cyclesAccess,
  endpoints: [
    {
      path: '/reconcile',
      method: 'post',
      handler: async (req) => {
        if (denied(req)) return json({ error: 'Not authorised' }, 403)

        const body = (await readBody(req)) as { project?: string; force?: boolean }

        if (!body.project) {
          const reports = await reconcileAllProjects(req.payload, { force: body.force })
          return json({ reports })
        }

        try {
          const project = (await req.payload.findByID({
            collection: 'projects',
            id: body.project,
            depth: 0,
            overrideAccess: true,
          })) as Project

          const report = await reconcileProjectCycles(req.payload, project, {
            force: body.force,
          })
          return json({ reports: [report] })
        } catch {
          return json({ error: 'That project could not be found.' }, 404)
        }
      },
    },
    {
      path: '/:id/burndown',
      method: 'get',
      handler: async (req) => {
        if (denied(req)) return json({ error: 'Not authorised' }, 403)

        const id = req.routeParams?.id
        if (typeof id !== 'string') return json({ error: 'A cycle id is required.' }, 400)

        try {
          const cycle = (await req.payload.findByID({
            collection: 'cycles',
            id,
            depth: 0,
            overrideAccess: true,
          })) as Cycle

          const projectId = String(
            typeof cycle.project === 'object' ? cycle.project.id : cycle.project,
          )
          const project = (await req.payload.findByID({
            collection: 'projects',
            id: projectId,
            depth: 0,
            overrideAccess: true,
          })) as Project

          const live = req.query?.live === 'true' || req.query?.live === '1'
          const series = await loadBurndown(req.payload, cycle, project, { live })

          return json({
            cycle: { id: String(cycle.id), name: cycle.name, number: cycle.number },
            project: { id: String(project.id), name: project.name },
            frozen: !live && Boolean(snapshotOf(cycle)),
            series,
          })
        } catch {
          return json({ error: 'That cycle could not be found.' }, 404)
        }
      },
    },
    {
      path: '/velocity',
      method: 'get',
      handler: async (req) => {
        if (denied(req)) return json({ error: 'Not authorised' }, 403)

        const projectId = req.query?.project
        if (typeof projectId !== 'string' || !projectId) {
          return json({ error: 'A project id is required.' }, 400)
        }

        try {
          const project = (await req.payload.findByID({
            collection: 'projects',
            id: projectId,
            depth: 0,
            overrideAccess: true,
          })) as Project

          const requested = Number(req.query?.window)
          const window = Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : undefined

          return json({
            project: { id: String(project.id), name: project.name },
            ...(await loadVelocity(req.payload, project, { window })),
          })
        } catch {
          return json({ error: 'That project could not be found.' }, 404)
        }
      },
    },
    {
      path: '/:id/close',
      method: 'post',
      handler: async (req) => {
        if (denied(req)) return json({ error: 'Not authorised' }, 403)

        const id = req.routeParams?.id
        if (typeof id !== 'string') return json({ error: 'A cycle id is required.' }, 400)

        try {
          const report = await closeCycleNow(req.payload, id)
          return json({ report })
        } catch {
          return json({ error: 'That cycle could not be closed.' }, 400)
        }
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data
        if (!data.name && typeof data.number === 'number') {
          data.name = defaultCycleName(data.number)
        }
        return data
      },
    ],
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        const startsAt = toIsoDate(data?.startsAt ?? originalDoc?.startsAt)
        const endsAt = toIsoDate(data?.endsAt ?? originalDoc?.endsAt)

        if (startsAt && endsAt && endsAt < startsAt) {
          throw new APIError('A cycle cannot end before it starts.', 400, undefined, true)
        }

        const number = data?.number ?? originalDoc?.number
        const projectValue = data?.project !== undefined ? data.project : originalDoc?.project
        const project =
          projectValue && typeof projectValue === 'object'
            ? (projectValue as { id: unknown }).id
            : projectValue

        if (number === undefined || number === null || !project) return data

        const clash = await req.payload.find({
          collection: 'cycles',
          depth: 0,
          limit: 1,
          where: {
            and: [
              { number: { equals: number } },
              { project: { equals: project } },
              ...(operation === 'update' && originalDoc?.id
                ? [{ id: { not_equals: originalDoc.id } }]
                : []),
            ],
          },
        })

        if (clash.docs.length > 0) {
          throw new APIError(
            `This project already has a cycle numbered ${number}.`,
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
          collection: 'tickets',
          where: { cycle: { equals: id } },
          data: { cycle: null },
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
        description: 'Shown on the cycle page and on tickets. Defaults to the cycle number.',
      },
    },
    {
      name: 'number',
      type: 'number',
      required: true,
      index: true,
      admin: {
        description: 'Sequential within the project, starting at 1. Never reused.',
      },
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      required: true,
      index: true,
      admin: {
        description: 'The project whose workflow this cycle belongs to',
      },
    },
    {
      name: 'startsAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'First day of the cycle',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'endsAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Last day of the cycle, inclusive',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'goal',
      type: 'text',
      admin: {
        description: 'Optional one-line goal for the cycle',
      },
    },
    {
      name: 'completedAt',
      type: 'date',
      index: true,
      admin: {
        description: 'Set when the cycle was closed and its incomplete work rolled over',
      },
    },
    {
      name: 'progressSnapshot',
      type: 'json',
      admin: {
        readOnly: true,
        description:
          'The burndown as it stood when the cycle closed. Frozen so the chart keeps reading the same afterwards, whatever happens to the tickets later.',
      },
    },
    {
      name: 'rolledOver',
      type: 'number',
      defaultValue: 0,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'How many tickets moved out of this cycle when it closed',
      },
    },
  ],
  timestamps: true,
}
