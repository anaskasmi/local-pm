import type { Payload, PayloadRequest } from 'payload'
import { APIError } from 'payload'
import type { Project, Status, Ticket } from '@/payload-types'
import { resolveAllStatuses } from '@/lib/workflow'
import {
  acceptStatusFor,
  cancelledStatusFor,
  partitionBySnooze,
  snoozeError,
  splitWorkflow,
  type TriageResolution,
} from '@/lib/triage'

export class TriageError extends APIError {
  constructor(message: string, status = 400) {
    super(message, status, null, true)
  }
}

export function triageEnabled(project: Project | null | undefined): boolean {
  return Boolean(project?.triage?.enabled)
}

export interface TriageQueue {
  statuses: Status[]
  workflow: Status[]
  pending: Ticket[]
  snoozed: Ticket[]
}

export async function loadTriageQueue(
  payload: Payload,
  projectId?: string | null,
  now: Date = new Date(),
): Promise<TriageQueue> {
  const statuses = await resolveAllStatuses(payload, projectId)
  const { triage, workflow } = splitWorkflow(statuses)

  if (triage.length === 0) {
    return { statuses: [], workflow, pending: [], snoozed: [] }
  }

  const found = await payload.find({
    collection: 'tickets',
    where: { status: { in: triage.map((status) => String(status.id)) } },
    limit: 200,
    depth: 2,
    sort: '-createdAt',
  })

  const { pending, snoozed } = partitionBySnooze(found.docs as Ticket[], now)
  return { statuses: triage, workflow, pending, snoozed }
}

export async function triageStatusForProject(
  payload: Payload,
  projectId: string,
): Promise<Status | null> {
  const statuses = await resolveAllStatuses(payload, projectId)
  return splitWorkflow(statuses).triage[0] ?? null
}

export interface ResolveInput {
  resolution: TriageResolution
  statusId?: string | null
  duplicateOf?: string | null
  snoozedUntil?: string | null
  comment?: string | null
}

export interface ResolveOutcome {
  ticket: Ticket
  status: Status | null
  resolution: TriageResolution
}

export async function resolveTriageTicket(
  req: PayloadRequest,
  ticketId: string,
  input: ResolveInput,
  now: Date = new Date(),
): Promise<ResolveOutcome> {
  const payload = req.payload

  const ticket = (await payload
    .findByID({ req, collection: 'tickets', id: ticketId, depth: 1, overrideAccess: true })
    .catch(() => null)) as Ticket | null

  if (!ticket) throw new TriageError('That ticket could not be found.', 404)

  const projectId = String(
    typeof ticket.project === 'object' && ticket.project ? ticket.project.id : ticket.project,
  )
  const statuses = await resolveAllStatuses(payload, projectId)
  const { triage } = splitWorkflow(statuses)

  const currentStatusId = String(
    typeof ticket.status === 'object' && ticket.status ? ticket.status.id : ticket.status,
  )
  const inTriage = triage.some((status) => String(status.id) === currentStatusId)
  if (!inTriage) {
    throw new TriageError('That ticket is not in triage, so there is nothing to resolve.')
  }

  const data: Record<string, unknown> = { snoozedUntil: null }
  let target: Status | null = null

  if (input.resolution === 'snooze') {
    const problem = snoozeError(input.snoozedUntil, now)
    if (problem) throw new TriageError(problem)
    data.snoozedUntil = input.snoozedUntil
  } else if (input.resolution === 'accept') {
    target = acceptStatusFor(statuses, input.statusId)
    if (!target) {
      throw new TriageError(
        'This project has no workflow status to accept into. Add one before accepting work.',
      )
    }
    data.status = String(target.id)
  } else if (input.resolution === 'decline') {
    target = cancelledStatusFor(statuses)
    if (!target) {
      throw new TriageError(
        'This project has no cancelled status to decline into. Add one before declining work.',
      )
    }
    data.status = String(target.id)
  } else {
    if (!input.duplicateOf) {
      throw new TriageError('Choose the ticket this one duplicates.')
    }
    if (String(input.duplicateOf) === String(ticket.id)) {
      throw new TriageError('A ticket cannot be a duplicate of itself.')
    }

    const canonical = (await payload
      .findByID({
        req,
        collection: 'tickets',
        id: String(input.duplicateOf),
        depth: 0,
        overrideAccess: true,
      })
      .catch(() => null)) as Ticket | null

    if (!canonical) throw new TriageError('That ticket could not be found.', 404)

    const canonicalProject = String(
      typeof canonical.project === 'object' && canonical.project
        ? canonical.project.id
        : canonical.project,
    )
    if (canonicalProject !== projectId) {
      throw new TriageError('A duplicate has to point at a ticket in the same project.')
    }

    target = cancelledStatusFor(statuses)
    if (!target) {
      throw new TriageError(
        'This project has no cancelled status to merge into. Add one before marking duplicates.',
      )
    }
    data.status = String(target.id)
    data.duplicateOf = String(canonical.id)
  }

  const updated = (await payload.update({
    req,
    collection: 'tickets',
    id: ticketId,
    data,
    depth: 2,
    overrideAccess: true,
  })) as Ticket

  const comment = (input.comment ?? '').trim()
  if (comment) {
    await payload.create({
      req,
      collection: 'comments',
      depth: 0,
      overrideAccess: true,
      data: { ticket: String(ticket.id), body: comment },
    })
  }

  return { ticket: updated, status: target, resolution: input.resolution }
}
