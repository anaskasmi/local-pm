import type { Payload } from 'payload'
import type { Status, Ticket } from '@/payload-types'
import { LEGACY_STATUS_KEYS } from '@/types/enums'
import { splitWorkflow } from '@/lib/triage'

export function slugifyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function legacyKeyFor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return LEGACY_STATUS_KEYS[value] ?? null
}

export function sortStatuses(statuses: Status[]): Status[] {
  return [...statuses].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
}

export async function resolveAllStatuses(
  payload: Payload,
  projectId?: string | null,
): Promise<Status[]> {
  const global = await payload.find({
    collection: 'statuses',
    limit: 100,
    depth: 0,
    where: { project: { exists: false } },
  })

  if (!projectId) return sortStatuses(global.docs as Status[])

  const scoped = await payload.find({
    collection: 'statuses',
    limit: 100,
    depth: 0,
    where: { project: { equals: projectId } },
  })

  return sortStatuses([...(global.docs as Status[]), ...(scoped.docs as Status[])])
}

export async function resolveWorkflow(payload: Payload, projectId?: string | null): Promise<Status[]> {
  return splitWorkflow(await resolveAllStatuses(payload, projectId)).workflow
}

export async function resolveTriageStatuses(
  payload: Payload,
  projectId?: string | null,
): Promise<Status[]> {
  return splitWorkflow(await resolveAllStatuses(payload, projectId)).triage
}

export function statusIdOf(ticket: Pick<Ticket, 'status'>): string | null {
  const status = ticket.status
  if (!status) return null
  return typeof status === 'string' ? status : String(status.id)
}

export function statusKeyOf(ticket: Pick<Ticket, 'status'>): string | null {
  const status = ticket.status
  if (!status || typeof status === 'string') return null
  return status.key
}

export function statusTypeOf(status: Status | string | null | undefined): string | null {
  return status && typeof status !== 'string' ? status.type : null
}

export function findStatusByKey(statuses: Status[], key: string): Status | undefined {
  return statuses.find((s) => s.key === key)
}
