import { describe, it, expect } from 'vitest'
import {
  matchStatus,
  projectIdOf,
  statusesForProject,
  unknownStatusMessage,
  type StatusDoc,
} from '../mcp-server/src/statuses'

const todo: StatusDoc = { id: 's1', key: 'todo', name: 'Todo', type: 'UNSTARTED', order: 1000 }
const started: StatusDoc = {
  id: 's2',
  key: 'in_progress',
  name: 'In Progress',
  type: 'STARTED',
  order: 2000,
}
const done: StatusDoc = { id: 's3', key: 'done', name: 'Done', type: 'COMPLETED', order: 3000 }
const review: StatusDoc = {
  id: 's4',
  key: 'in_review',
  name: 'In Review',
  type: 'STARTED',
  order: 2500,
  project: 'p1',
}
const otherReview: StatusDoc = {
  id: 's5',
  key: 'ux_review',
  name: 'UX Review',
  type: 'STARTED',
  order: 2600,
  project: { id: 'p2' },
}

const all = [done, review, todo, otherReview, started]

describe('statusesForProject', () => {
  it('returns only workspace statuses when no project is given', () => {
    expect(statusesForProject(all).map((s) => s.key)).toEqual(['todo', 'in_progress', 'done'])
  })

  it('splices a project status into the workspace workflow by order', () => {
    expect(statusesForProject(all, 'p1').map((s) => s.key)).toEqual([
      'todo',
      'in_progress',
      'in_review',
      'done',
    ])
  })

  it('never leaks another project status into this project workflow', () => {
    expect(statusesForProject(all, 'p1').map((s) => s.key)).not.toContain('ux_review')
    expect(statusesForProject(all, 'p2').map((s) => s.key)).not.toContain('in_review')
  })

  it('reads a project relationship given as an object or as an id', () => {
    expect(statusesForProject(all, 'p2').map((s) => s.key)).toContain('ux_review')
  })

  it('treats a missing order as first rather than dropping the status', () => {
    const unordered: StatusDoc = { id: 's6', key: 'triage', name: 'Triage', type: 'BACKLOG' }
    expect(statusesForProject([...all, unordered]).map((s) => s.key)).toEqual([
      'triage',
      'todo',
      'in_progress',
      'done',
    ])
  })
})

describe('matchStatus', () => {
  const scope = statusesForProject(all, 'p1')

  it('matches a key, a name and an id, case-insensitively', () => {
    expect(matchStatus(all, scope, 'in_review')?.id).toBe('s4')
    expect(matchStatus(all, scope, 'In Review')?.id).toBe('s4')
    expect(matchStatus(all, scope, 'IN REVIEW')?.id).toBe('s4')
    expect(matchStatus(all, scope, 's4')?.id).toBe('s4')
  })

  it('tolerates surrounding whitespace', () => {
    expect(matchStatus(all, scope, '  Done  ')?.id).toBe('s3')
  })

  it('does not match a status scoped to a different project by key or name', () => {
    expect(matchStatus(all, scope, 'ux_review')).toBeUndefined()
    expect(matchStatus(all, scope, 'UX Review')).toBeUndefined()
  })

  it('still resolves an explicit id from outside the scope, so an id is never wrong', () => {
    expect(matchStatus(all, scope, 's5')?.id).toBe('s5')
  })

  it('returns undefined for a value that matches nothing', () => {
    expect(matchStatus(all, scope, 'nonsense')).toBeUndefined()
  })
})

describe('unknownStatusMessage', () => {
  it('names the keys the caller could have used, scoped to the project', () => {
    expect(unknownStatusMessage('nonsense', statusesForProject(all, 'p1'))).toBe(
      'Unknown status "nonsense". Available statuses: todo, in_progress, in_review, done',
    )
  })

  it('says so plainly when the workspace has no statuses at all', () => {
    expect(unknownStatusMessage('todo', [])).toBe(
      'Unknown status "todo". Available statuses: (none configured)',
    )
  })
})

describe('projectIdOf', () => {
  it('reads an id from a string, an object, or nothing', () => {
    expect(projectIdOf('p1')).toBe('p1')
    expect(projectIdOf({ id: 'p2' })).toBe('p2')
    expect(projectIdOf(null)).toBeUndefined()
    expect(projectIdOf(undefined)).toBeUndefined()
  })
})
