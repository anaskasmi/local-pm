import { execFileSync } from 'node:child_process'

export const DEFAULT_PORT_BASE = 3020
export const DEFAULT_PORT_SCAN_LIMIT = 20
export const DEFAULT_MONGO_PORT_BASE = 27018
export const DEFAULT_SOURCE_URI = 'mongodb://localhost:27018/local-pm'

export interface RunContext {
  port: number
  baseUrl: string
  sourceUri: string
  databaseUri: string
  databaseName: string
  distDir: string
  outputDir: string
  mongoPort: number | null
  managesMongo: boolean
}

export function withDatabase(uri: string, dbName: string): string {
  const [base, query] = uri.split('?')
  const trimmed = base.replace(/\/[^/]*$/, '')
  return `${trimmed}/${dbName}${query ? `?${query}` : ''}`
}

export function databaseNameFor(port: number): string {
  return `local-pm-e2e-${port}`
}

export function distDirFor(port: number): string {
  return `.next-e2e-${port}`
}

export function outputDirFor(port: number): string {
  return `test-results-${port}`
}

export function databaseNameOf(uri: string): string {
  const path = uri.split('?')[0].replace(/^[a-z+]+:\/\/[^/]*/i, '')
  return path.replace(/^\//, '')
}

export function localMongoUri(port: number): string {
  return `mongodb://localhost:${port}/local-pm`
}

export function parsePort(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`E2E_PORT must be an integer between 1 and 65535, received "${value}".`)
  }
  return port
}

export function mongoPortFor(
  appPort: number,
  appBase = DEFAULT_PORT_BASE,
  mongoBase = DEFAULT_MONGO_PORT_BASE,
): number {
  const port = mongoBase + (appPort - appBase)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Deriving a mongod port from app port ${appPort} gave ${port}, which is out of range. ` +
        'Pin one with E2E_MONGO_PORT.',
    )
  }
  return port
}

export interface MongoResolution {
  sourceUri: string
  mongoPort: number | null
  managesMongo: boolean
}

export function resolveMongo(env: RunEnv, appPort: number): MongoResolution {
  if (env.E2E_MONGO_URI) {
    return { sourceUri: env.E2E_MONGO_URI, mongoPort: null, managesMongo: false }
  }

  const port =
    parsePort(env.E2E_MONGO_PORT) ??
    mongoPortFor(appPort, parsePort(env.E2E_PORT_BASE) ?? DEFAULT_PORT_BASE)

  return { sourceUri: localMongoUri(port), mongoPort: port, managesMongo: true }
}

const PROBE = `
const net = require('net')
const base = Number(process.argv[1])
const limit = Number(process.argv[2])
const free = (port) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port)
  })
;(async () => {
  for (let port = base; port < base + limit; port += 1) {
    if (await free(port)) {
      process.stdout.write(String(port))
      return
    }
  }
  process.exit(3)
})()
`

export function findFreePort(base = DEFAULT_PORT_BASE, limit = DEFAULT_PORT_SCAN_LIMIT): number {
  let out: string
  try {
    out = execFileSync(process.execPath, ['-e', PROBE, String(base), String(limit)], {
      encoding: 'utf8',
      timeout: 30_000,
    })
  } catch {
    throw new Error(
      `No free port for the e2e server in ${base}-${base + limit - 1}. ` +
        'Close another e2e run, or pin one with E2E_PORT.',
    )
  }

  const port = Number(out.trim())
  if (!Number.isInteger(port)) throw new Error(`Port probe returned "${out}".`)
  return port
}

export type RunEnv = Record<string, string | undefined>

export function resolveRunContext(env: RunEnv = process.env): RunContext {
  const pinned = parsePort(env.E2E_PORT)
  const port =
    pinned ??
    findFreePort(
      parsePort(env.E2E_PORT_BASE) ?? DEFAULT_PORT_BASE,
      Number(env.E2E_PORT_SCAN_LIMIT ?? DEFAULT_PORT_SCAN_LIMIT),
    )

  const mongo = resolveMongo(env, port)
  const databaseUri = env.E2E_DATABASE_URI ?? withDatabase(mongo.sourceUri, databaseNameFor(port))

  if (env.DATABASE_URI !== undefined && databaseUri === env.DATABASE_URI) {
    throw new Error(
      'Refusing to run e2e against the same database as DATABASE_URI. Set E2E_DATABASE_URI explicitly.',
    )
  }

  env.E2E_PORT = String(port)
  env.E2E_DATABASE_URI = databaseUri

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    sourceUri: mongo.sourceUri,
    databaseUri,
    databaseName: databaseNameOf(databaseUri),
    distDir: distDirFor(port),
    outputDir: outputDirFor(port),
    mongoPort: mongo.mongoPort,
    managesMongo: mongo.managesMongo,
  }
}
