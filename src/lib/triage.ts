import { StatusType } from '@/types/enums'
import type { Status } from '@/payload-types'

export const TRIAGE_STATUS_KEY = 'triage'
export const TRIAGE_STATUS_NAME = 'Triage'
export const TRIAGE_STATUS_ORDER = 0

export const DECLINED_STATUS_KEY = 'declined'
export const DECLINED_STATUS_NAME = 'Declined'
export const DECLINED_STATUS_ORDER = 5000

export const TRIAGE_RESOLUTIONS = ['accept', 'duplicate', 'decline', 'snooze'] as const
export type TriageResolution = (typeof TRIAGE_RESOLUTIONS)[number]

export function isTriageResolution(value: unknown): value is TriageResolution {
  return typeof value === 'string' && (TRIAGE_RESOLUTIONS as readonly string[]).includes(value)
}

export function isTriageType(type: string | null | undefined): boolean {
  return type === StatusType.TRIAGE
}

export function isTriageStatus(status: Status | string | null | undefined): boolean {
  if (!status || typeof status === 'string') return false
  return isTriageType(status.type)
}

export interface WorkflowSplit {
  triage: Status[]
  workflow: Status[]
}

export function splitWorkflow(statuses: Status[]): WorkflowSplit {
  const triage: Status[] = []
  const workflow: Status[] = []
  for (const status of statuses) {
    if (isTriageType(status.type)) triage.push(status)
    else workflow.push(status)
  }
  return { triage, workflow }
}

export function triageStatusIds(statuses: Status[]): string[] {
  return splitWorkflow(statuses).triage.map((status) => String(status.id))
}

export interface SnoozeState {
  snoozedUntil?: string | null
}

export const SNOOZE_FIELDS = ['snoozedUntil'] as const

function time(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

export function isSnoozed(ticket: SnoozeState, now: Date = new Date()): boolean {
  const until = time(ticket.snoozedUntil)
  return until !== null && until > now.getTime()
}

export function changedFields(
  data: Record<string, unknown> | null | undefined,
  originalDoc: Record<string, unknown> | null | undefined,
): string[] {
  if (!data) return []
  if (!originalDoc) return Object.keys(data)

  return Object.keys(data).filter((key) => {
    const next = data[key]
    const previous = originalDoc[key]
    if (next === previous) return false
    return JSON.stringify(next ?? null) !== JSON.stringify(previous ?? null)
  })
}

export function wakesSnooze(changed: string[]): boolean {
  return changed.some((field) => !(SNOOZE_FIELDS as readonly string[]).includes(field))
}

export interface TriagePartition<T> {
  pending: T[]
  snoozed: T[]
}

export function partitionBySnooze<T extends SnoozeState>(
  tickets: T[],
  now: Date = new Date(),
): TriagePartition<T> {
  const pending: T[] = []
  const snoozed: T[] = []
  for (const ticket of tickets) {
    if (isSnoozed(ticket, now)) snoozed.push(ticket)
    else pending.push(ticket)
  }
  return { pending, snoozed }
}

export function snoozeError(until: string | null | undefined, now: Date = new Date()): string | null {
  if (!until) return 'Choose a date to snooze until.'
  const parsed = time(until)
  if (parsed === null) return 'That is not a date we can read. Use YYYY-MM-DD.'
  if (parsed <= now.getTime()) return 'Snoozing needs a date in the future. Choose a later day.'
  return null
}

export function acceptStatusFor(statuses: Status[], preferredId?: string | null): Status | null {
  const { workflow } = splitWorkflow(statuses)
  if (workflow.length === 0) return null

  if (preferredId) {
    const chosen = workflow.find((status) => String(status.id) === String(preferredId))
    if (chosen) return chosen
  }

  const byOrder = [...workflow].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return byOrder.find((status) => status.type === StatusType.UNSTARTED) ?? byOrder[0]
}

export function cancelledStatusFor(statuses: Status[]): Status | null {
  const cancelled = statuses
    .filter((status) => status.type === StatusType.CANCELLED)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return cancelled[0] ?? null
}
