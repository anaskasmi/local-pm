import { describe, it, expect } from 'vitest'
import {
  TRIAGE_STATUS_KEY,
  acceptStatusFor,
  cancelledStatusFor,
  isSnoozed,
  isTriageResolution,
  isTriageStatus,
  isTriageType,
  partitionBySnooze,
  snoozeError,
  changedFields,
  wakesSnooze,
  splitWorkflow,
  triageStatusIds,
  type SnoozeState,
} from '@/lib/triage'
import { StatusType } from '@/types/enums'
import type { Status } from '@/payload-types'

function status(partial: Partial<Status> & { id: string; type: string }): Status {
  return {
    name: partial.name ?? partial.id,
    key: partial.key ?? partial.id,
    order: partial.order ?? 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Status
}

const TRIAGE = status({ id: 't', key: TRIAGE_STATUS_KEY, name: 'Triage', type: StatusType.TRIAGE, order: 0 })
const BACKLOG = status({ id: 'b', name: 'Backlog', type: StatusType.BACKLOG, order: 500 })
const TODO = status({ id: 'u', name: 'Todo', type: StatusType.UNSTARTED, order: 1000 })
const DOING = status({ id: 's', name: 'In progress', type: StatusType.STARTED, order: 2000 })
const DONE = status({ id: 'd', name: 'Done', type: StatusType.COMPLETED, order: 3000 })
const CANCELLED = status({ id: 'x', name: 'Cancelled', type: StatusType.CANCELLED, order: 4000 })

const ALL = [TRIAGE, BACKLOG, TODO, DOING, DONE, CANCELLED]

describe('isTriageType / isTriageStatus', () => {
  it('recognises the triage type', () => {
    expect(isTriageType(StatusType.TRIAGE)).toBe(true)
    expect(isTriageType(StatusType.BACKLOG)).toBe(false)
    expect(isTriageType(null)).toBe(false)
    expect(isTriageType(undefined)).toBe(false)
  })

  it('reads the type off a populated status', () => {
    expect(isTriageStatus(TRIAGE)).toBe(true)
    expect(isTriageStatus(TODO)).toBe(false)
  })

  it('treats an unpopulated relationship as not triage rather than guessing', () => {
    expect(isTriageStatus('t')).toBe(false)
    expect(isTriageStatus(null)).toBe(false)
  })
})

describe('splitWorkflow', () => {
  it('separates triage from the workflow and keeps order within each', () => {
    const { triage, workflow } = splitWorkflow(ALL)
    expect(triage.map((s) => s.id)).toEqual(['t'])
    expect(workflow.map((s) => s.id)).toEqual(['b', 'u', 's', 'd', 'x'])
  })

  it('gives an empty triage list when the project has no triage status', () => {
    const { triage, workflow } = splitWorkflow([BACKLOG, TODO])
    expect(triage).toEqual([])
    expect(workflow).toHaveLength(2)
  })

  it('collects the triage ids', () => {
    expect(triageStatusIds(ALL)).toEqual(['t'])
    expect(triageStatusIds([TODO, DONE])).toEqual([])
  })
})

describe('acceptStatusFor', () => {
  it('honours an explicitly chosen workflow status', () => {
    expect(acceptStatusFor(ALL, 's')?.id).toBe('s')
  })

  it('never accepts back into triage, even when it is asked to', () => {
    expect(acceptStatusFor(ALL, 't')?.id).toBe('u')
  })

  it('defaults to the first unstarted status rather than the lowest order', () => {
    expect(acceptStatusFor(ALL)?.id).toBe('u')
  })

  it('falls back to the lowest-ordered workflow status when nothing is unstarted', () => {
    expect(acceptStatusFor([TRIAGE, DOING, DONE])?.id).toBe('s')
  })

  it('returns null when there is no workflow to accept into', () => {
    expect(acceptStatusFor([TRIAGE])).toBeNull()
  })
})

describe('cancelledStatusFor', () => {
  it('finds the cancelled status decline and duplicate land in', () => {
    expect(cancelledStatusFor(ALL)?.id).toBe('x')
  })

  it('returns null when the workflow has no cancelled status', () => {
    expect(cancelledStatusFor([TRIAGE, TODO, DONE])).toBeNull()
  })
})

describe('snoozeError', () => {
  const now = new Date('2026-09-22T12:00:00.000Z')

  it('asks for a date when none is given', () => {
    expect(snoozeError(null, now)).toBe('Choose a date to snooze until.')
    expect(snoozeError('', now)).toBe('Choose a date to snooze until.')
  })

  it('rejects something it cannot parse, and names the format', () => {
    expect(snoozeError('next tuesday', now)).toContain('YYYY-MM-DD')
  })

  it('rejects a date in the past and says what to do instead', () => {
    expect(snoozeError('2026-09-01', now)).toBe(
      'Snoozing needs a date in the future. Choose a later day.',
    )
  })

  it('rejects now itself, since that would wake immediately', () => {
    expect(snoozeError('2026-09-22T12:00:00.000Z', now)).not.toBeNull()
  })

  it('accepts a future date', () => {
    expect(snoozeError('2026-09-30', now)).toBeNull()
  })
})

describe('isSnoozed', () => {
  const now = new Date('2026-09-22T12:00:00.000Z')

  it('is not snoozed when no snooze is set', () => {
    expect(isSnoozed({}, now)).toBe(false)
    expect(isSnoozed({ snoozedUntil: null }, now)).toBe(false)
  })

  it('is snoozed while the date is still ahead', () => {
    expect(isSnoozed({ snoozedUntil: '2026-09-30' }, now)).toBe(true)
  })

  it('wakes once the date has passed', () => {
    expect(isSnoozed({ snoozedUntil: '2026-09-20' }, now)).toBe(false)
  })

  it('wakes on the moment itself rather than lingering', () => {
    expect(isSnoozed({ snoozedUntil: '2026-09-22T12:00:00.000Z' }, now)).toBe(false)
  })

  it('treats an unreadable date as not snoozed rather than hiding the item forever', () => {
    expect(isSnoozed({ snoozedUntil: 'soon' }, now)).toBe(false)
  })
})

describe('wakesSnooze', () => {
  it('does not wake on a write that only touches the snooze itself', () => {
    expect(wakesSnooze(['snoozedUntil'])).toBe(false)
  })

  it('wakes as soon as the write touches anything else', () => {
    expect(wakesSnooze(['title'])).toBe(true)
    expect(wakesSnooze(['snoozedUntil', 'status'])).toBe(true)
    expect(wakesSnooze(['assignee', 'priority'])).toBe(true)
  })

  it('does not wake on an empty write', () => {
    expect(wakesSnooze([])).toBe(false)
  })
})

describe('changedFields', () => {
  it('reports nothing when the write matches what is stored', () => {
    expect(changedFields({ title: 'A', status: 's' }, { title: 'A', status: 's' })).toEqual([])
  })

  it('reports only the fields that actually differ', () => {
    expect(changedFields({ title: 'B', status: 's' }, { title: 'A', status: 's' })).toEqual(['title'])
  })

  it('treats null and undefined as the same absence', () => {
    expect(changedFields({ snoozedUntil: null }, { snoozedUntil: undefined })).toEqual([])
  })

  it('compares nested values structurally', () => {
    expect(changedFields({ triage: { enabled: true } }, { triage: { enabled: true } })).toEqual([])
    expect(changedFields({ triage: { enabled: true } }, { triage: { enabled: false } })).toEqual([
      'triage',
    ])
  })

  it('treats every key as changed when there is nothing to compare against', () => {
    expect(changedFields({ title: 'A' }, null)).toEqual(['title'])
  })

  it('handles an empty write', () => {
    expect(changedFields(null, { title: 'A' })).toEqual([])
  })
})

describe('the snooze wake rule, end to end', () => {
  it('a re-snooze keeps the snooze, an edit clears it', () => {
    const stored = { snoozedUntil: '2027-05-01', title: 'A' }

    expect(wakesSnooze(changedFields({ snoozedUntil: '2027-06-01', title: 'A' }, stored))).toBe(false)
    expect(wakesSnooze(changedFields({ snoozedUntil: '2027-05-01', title: 'B' }, stored))).toBe(true)
  })
})

describe('partitionBySnooze', () => {
  const now = new Date('2026-09-22T12:00:00.000Z')

  it('splits the queue into pending and snoozed', () => {
    const rows: (SnoozeState & { id: string })[] = [
      { id: 'a', snoozedUntil: '2026-09-30' },
      { id: 'b' },
      { id: 'c', snoozedUntil: '2026-09-01' },
    ]

    const { pending, snoozed } = partitionBySnooze(rows, now)
    expect(snoozed.map((t) => t.id)).toEqual(['a'])
    expect(pending.map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('keeps the incoming order within each half', () => {
    const rows: (SnoozeState & { id: string })[] = [{ id: '1' }, { id: '2' }, { id: '3' }]
    const { pending } = partitionBySnooze(rows, now)
    expect(pending.map((t) => t.id)).toEqual(['1', '2', '3'])
  })
})

describe('isTriageResolution', () => {
  it('accepts the four resolutions', () => {
    for (const value of ['accept', 'duplicate', 'decline', 'snooze']) {
      expect(isTriageResolution(value)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isTriageResolution('delete')).toBe(false)
    expect(isTriageResolution('')).toBe(false)
    expect(isTriageResolution(null)).toBe(false)
    expect(isTriageResolution(1)).toBe(false)
  })
})
