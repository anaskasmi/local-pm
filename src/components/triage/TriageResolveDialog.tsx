'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DatePicker } from '@/components/ui/DatePicker'
import { Dialog } from '@/components/ui/Dialog'
import { TicketSelect } from '@/components/ui/EntityPickers'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { statusTypeMeta } from '@/lib/status'
import { snoozeError } from '@/lib/triage'
import type { Status, Ticket } from '@/payload-types'

export type DialogKind = 'accept' | 'duplicate' | 'decline' | 'snooze'

export interface DialogMode {
  kind: DialogKind
  ticket: Ticket
}

type WorkflowStatus = Pick<Status, 'id' | 'name' | 'key' | 'type'>

const TITLES: Record<DialogKind, string> = {
  accept: 'Accept into the workflow',
  duplicate: 'Mark as duplicate',
  decline: 'Decline this work',
  snooze: 'Snooze until later',
}

const DESCRIPTIONS: Record<DialogKind, string> = {
  accept: 'Choose the status this work starts in.',
  duplicate: 'Pick the ticket this one duplicates. This one is cancelled and linked to it.',
  decline: 'This is cancelled rather than deleted, so the record and its history stay.',
  snooze: 'It leaves the queue and comes back on this date, or sooner if anyone touches it.',
}

const CONFIRM: Record<DialogKind, string> = {
  accept: 'Accept ticket',
  duplicate: 'Mark as duplicate',
  decline: 'Decline ticket',
  snooze: 'Snooze ticket',
}

const DONE: Record<DialogKind, string> = {
  accept: 'Accepted',
  duplicate: 'Marked as duplicate',
  decline: 'Declined',
  snooze: 'Snoozed',
}

export function TriageResolveDialog({
  mode,
  workflow,
  busy,
  onClose,
  onSubmit,
}: {
  mode: DialogMode
  workflow: WorkflowStatus[]
  busy: boolean
  onClose: () => void
  onSubmit: (body: Record<string, unknown>, done: string) => Promise<boolean>
}) {
  const { kind, ticket } = mode

  const statusOptions = useMemo(
    () =>
      workflow.map((status) => ({
        value: String(status.id),
        label: status.name,
        icon: statusTypeMeta(status.type).icon,
      })),
    [workflow],
  )

  const [statusId, setStatusId] = useState(statusOptions[0]?.value ?? '')
  const [duplicateOf, setDuplicateOf] = useState('')
  const [snoozedUntil, setSnoozedUntil] = useState('')
  const [comment, setComment] = useState('')
  const [attempted, setAttempted] = useState(false)

  const projectId =
    typeof ticket.project === 'object' && ticket.project ? String(ticket.project.id) : ticket.project

  const error = (() => {
    if (!attempted) return null
    if (kind === 'duplicate' && !duplicateOf) return 'Choose the ticket this one duplicates.'
    if (kind === 'snooze') return snoozeError(snoozedUntil)
    return null
  })()

  const submit = async () => {
    setAttempted(true)

    if (kind === 'duplicate' && !duplicateOf) return
    if (kind === 'snooze' && snoozeError(snoozedUntil)) return

    const body: Record<string, unknown> = { resolution: kind }
    if (kind === 'accept' && statusId) body.status = statusId
    if (kind === 'duplicate') body.duplicateOf = duplicateOf
    if (kind === 'snooze') body.snoozedUntil = snoozedUntil
    if (comment.trim()) body.comment = comment.trim()

    await onSubmit(body, DONE[kind])
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={TITLES[kind]}
      description={DESCRIPTIONS[kind]}
      size="sm"
      initialFocus={kind === 'decline' ? 'none' : 'first-field'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={kind === 'decline' ? 'danger' : 'primary'}
            onClick={submit}
            loading={busy}
          >
            {CONFIRM[kind]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text">{ticket.title}</span>
          {ticket.ticketId ? <span className="ml-2 tabular-nums">{ticket.ticketId}</span> : null}
        </p>

        {kind === 'accept' ? (
          <Field label="Status">
            {({ id }) => (
              <Select
                id={id}
                value={statusId}
                options={statusOptions}
                onValueChange={setStatusId}
              />
            )}
          </Field>
        ) : null}

        {kind === 'duplicate' ? (
          <Field label="Duplicate of" error={error ?? undefined}>
            {({ id, describedBy }) => (
              <TicketSelect
                id={id}
                aria-describedby={describedBy}
                value={duplicateOf}
                invalid={Boolean(error)}
                onChange={(value) => setDuplicateOf(value)}
                where={{ project: typeof projectId === 'string' ? projectId : undefined }}
                placeholder="Search tickets"
              />
            )}
          </Field>
        ) : null}

        {kind === 'snooze' ? (
          <Field
            label="Snooze until"
            error={error ?? undefined}
            hint="Type YYYY-MM-DD, or pick a day."
          >
            {({ id, describedBy }) => (
              <DatePicker
                id={id}
                aria-describedby={describedBy}
                label="the snooze date"
                value={snoozedUntil}
                onChange={setSnoozedUntil}
              />
            )}
          </Field>
        ) : null}

        <Field label="Comment" optional hint="Explains the decision on the ticket.">
          {({ id, describedBy }) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
