import { test, expect } from '@playwright/test'
import { seedProject, createTicket, type SeedRefs } from './helpers'
import type { RunContext } from './run-context'

const runOf = (): RunContext => {
  const run = test.info().config.metadata.run as RunContext | undefined
  if (!run) throw new Error('The run context is missing from the Playwright config metadata.')
  return run
}

test.describe('the suite runs against a local mongod', () => {
  test('the database is on loopback, not a remote cluster', () => {
    const { databaseUri } = runOf()

    expect(databaseUri.startsWith('mongodb://')).toBeTruthy()
    expect(databaseUri).not.toContain('mongodb+srv')
    expect(databaseUri).toMatch(/^mongodb:\/\/(localhost|127\.0\.0\.1):\d+\//)
  })

  test('the database is this run own, never the working one', () => {
    const { databaseName, port } = runOf()

    expect(databaseName).toBe(`local-pm-e2e-${port}`)
    expect(databaseName).not.toBe('local-pm')
  })

  test('a write round trip survives, so transactions have a replica set', async ({ request }) => {
    const refs: SeedRefs = await seedProject(request, 'local-mongo')
    const created = await createTicket(request, refs, { title: 'Local mongo write' })

    expect(created.ok()).toBeTruthy()

    const { doc } = await created.json()
    const read = await request.get(`/api/tickets/${doc.id}`)

    expect(read.ok()).toBeTruthy()
    expect((await read.json()).title).toBe('Local mongo write')
  })
})
