import type { FullConfig } from '@playwright/test'
import type { Payload } from 'payload'
import dotenv from 'dotenv'
import { resolveRunContext, type RunContext } from './run-context'

dotenv.config()

function runContextOf(config?: FullConfig): RunContext {
  const fromMetadata = config?.metadata?.run as RunContext | undefined
  return fromMetadata ?? resolveRunContext()
}

async function resetDatabase(payload: Payload): Promise<number> {
  const db = payload.db.connection.db
  if (!db) throw new Error('E2E reset could not reach the Mongo connection.')

  const collections = await db.collections()
  let cleared = 0

  for (const collection of collections) {
    const { deletedCount } = await collection.deleteMany({})
    cleared += deletedCount ?? 0
  }

  return cleared
}

export default async function globalSetup(config?: FullConfig) {
  const run = runContextOf(config)

  if (run.databaseUri === process.env.DATABASE_URI) {
    throw new Error('Refusing to migrate the working database from the e2e setup.')
  }

  const originalUri = process.env.DATABASE_URI
  process.env.DATABASE_URI = run.databaseUri

  try {
    const { getPayload } = await import('payload')
    const { default: config } = await import('../src/payload.config')
    const { migrateTicketStatuses } = await import('../src/migrations/configurable-statuses')
    const { migrateInlineLabels } = await import('../src/migrations/shared-labels')

    const payload = await getPayload({ config })

    if (process.env.E2E_KEEP_DATABASE !== 'true') {
      const cleared = await resetDatabase(payload)
      console.log(
        `[e2e] port ${run.port} · ${run.databaseName} · ${run.sourceUri} · cleared ${cleared} documents`,
      )
    }

    const report = await migrateTicketStatuses(payload)

    if (report.ticketsUnresolved.length > 0) {
      throw new Error(
        `E2E database has ${report.ticketsUnresolved.length} tickets whose status could not be resolved.`,
      )
    }

    const labelReport = await migrateInlineLabels(payload)

    if (labelReport.ticketsUnresolved.length > 0) {
      throw new Error(
        `E2E database has ${labelReport.ticketsUnresolved.length} tickets whose labels could not be resolved.`,
      )
    }

    await payload.destroy?.()
  } finally {
    if (originalUri === undefined) delete process.env.DATABASE_URI
    else process.env.DATABASE_URI = originalUri
  }
}
