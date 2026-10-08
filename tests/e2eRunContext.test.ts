import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MONGO_PORT_BASE,
  DEFAULT_SOURCE_URI,
  databaseNameFor,
  databaseNameOf,
  distDirFor,
  localMongoUri,
  mongoPortFor,
  outputDirFor,
  parsePort,
  resolveMongo,
  resolveRunContext,
  withDatabase,
  type RunEnv,
} from '../e2e/run-context'

const ATLAS = 'mongodb+srv://user:pass@local-pm.sbi9fhp.mongodb.net/local-pm?retryWrites=true'

const env = (overrides: Record<string, string> = {}): RunEnv => ({
  DATABASE_URI: 'mongodb://localhost:27018/local-pm',
  E2E_PORT: '3020',
  ...overrides,
})

describe('withDatabase', () => {
  it('swaps the database name and keeps the query string', () => {
    expect(withDatabase('mongodb://localhost:27018/local-pm', 'x')).toBe(
      'mongodb://localhost:27018/x',
    )
    expect(withDatabase('mongodb+srv://u:p@host/local-pm?retryWrites=true', 'x')).toBe(
      'mongodb+srv://u:p@host/x?retryWrites=true',
    )
  })
})

describe('databaseNameOf', () => {
  it('reads the database out of a uri', () => {
    expect(databaseNameOf('mongodb://localhost:27018/local-pm-e2e-3020')).toBe('local-pm-e2e-3020')
    expect(databaseNameOf('mongodb+srv://u:p@host/db?retryWrites=true')).toBe('db')
  })
})

describe('parsePort', () => {
  it('treats absent and empty as unset', () => {
    expect(parsePort(undefined)).toBeNull()
    expect(parsePort('   ')).toBeNull()
  })

  it('accepts a port in range', () => {
    expect(parsePort('3021')).toBe(3021)
  })

  it('rejects anything that is not a usable port', () => {
    expect(() => parsePort('nope')).toThrow(/between 1 and 65535/)
    expect(() => parsePort('0')).toThrow()
    expect(() => parsePort('70000')).toThrow()
    expect(() => parsePort('3020.5')).toThrow()
  })
})

describe('mongoPortFor', () => {
  it('pairs the first app port with the default mongo port', () => {
    expect(mongoPortFor(3020)).toBe(DEFAULT_MONGO_PORT_BASE)
  })

  it('gives every app port its own mongod', () => {
    const ports = [3020, 3021, 3022, 3031].map((p) => mongoPortFor(p))
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('tracks a shifted app base so the pairing survives E2E_PORT_BASE', () => {
    expect(mongoPortFor(4000, 4000)).toBe(DEFAULT_MONGO_PORT_BASE)
  })

  it('refuses a derived port outside the usable range', () => {
    expect(() => mongoPortFor(65000)).toThrow(/out of range/)
  })
})

describe('resolveMongo', () => {
  it('manages its own mongod on a port derived from the app port', () => {
    expect(resolveMongo({}, 3020)).toEqual({
      sourceUri: localMongoUri(27018),
      mongoPort: 27018,
      managesMongo: true,
    })
  })

  it('steps aside for a mongod the caller already runs', () => {
    const external = 'mongodb://localhost:27017/local-pm'
    expect(resolveMongo({ E2E_MONGO_URI: external }, 3020)).toEqual({
      sourceUri: external,
      mongoPort: null,
      managesMongo: false,
    })
  })

  it('honours a pinned mongo port', () => {
    expect(resolveMongo({ E2E_MONGO_PORT: '27050' }, 3020)).toMatchObject({
      sourceUri: localMongoUri(27050),
      mongoPort: 27050,
    })
  })

  it('never reads DATABASE_URI', () => {
    expect(resolveMongo({ DATABASE_URI: ATLAS }, 3020).sourceUri).toBe(localMongoUri(27018))
  })
})

describe('resolveRunContext', () => {
  it('derives every shared resource from the port', () => {
    const run = resolveRunContext(env())

    expect(run.port).toBe(3020)
    expect(run.baseUrl).toBe('http://127.0.0.1:3020')
    expect(run.databaseUri).toBe('mongodb://localhost:27018/local-pm-e2e-3020')
    expect(run.databaseName).toBe('local-pm-e2e-3020')
    expect(run.distDir).toBe('.next-e2e-3020')
    expect(run.outputDir).toBe('test-results-3020')
    expect(run.mongoPort).toBe(27018)
    expect(run.managesMongo).toBe(true)
  })

  it('gives two runs on different ports no shared resource', () => {
    const a = resolveRunContext(env({ E2E_PORT: '3020' }))
    const b = resolveRunContext(env({ E2E_PORT: '3021' }))

    expect(a.port).not.toBe(b.port)
    expect(a.databaseUri).not.toBe(b.databaseUri)
    expect(a.distDir).not.toBe(b.distDir)
    expect(a.outputDir).not.toBe(b.outputDir)
    expect(a.baseUrl).not.toBe(b.baseUrl)
    expect(a.mongoPort).not.toBe(b.mongoPort)
  })

  it('publishes the resolution so a later call in the same run agrees', () => {
    const shared = env({ E2E_PORT: '3022' })
    const first = resolveRunContext(shared)

    expect(shared.E2E_PORT).toBe('3022')
    expect(shared.E2E_DATABASE_URI).toBe(first.databaseUri)
    expect(resolveRunContext(shared)).toEqual(first)
  })

  it('honours an explicitly pinned database', () => {
    const run = resolveRunContext(env({ E2E_DATABASE_URI: 'mongodb://localhost:27018/pinned' }))

    expect(run.databaseUri).toBe('mongodb://localhost:27018/pinned')
    expect(run.databaseName).toBe('pinned')
  })

  it('refuses to point the suite at the working database', () => {
    expect(() =>
      resolveRunContext(env({ E2E_DATABASE_URI: 'mongodb://localhost:27018/local-pm' })),
    ).toThrow(/Refusing to run e2e/)
  })

  it('keeps the suite off a remote DATABASE_URI', () => {
    const run = resolveRunContext({ DATABASE_URI: ATLAS, E2E_PORT: '3023' })

    expect(run.databaseUri).not.toContain('mongodb+srv')
    expect(run.databaseUri).not.toContain('mongodb.net')
    expect(run.databaseUri).toBe(withDatabase(localMongoUri(27021), databaseNameFor(3023)))
  })

  it('uses a local source when nothing is configured at all', () => {
    const run = resolveRunContext({ E2E_PORT: '3020' })

    expect(run.sourceUri).toBe(DEFAULT_SOURCE_URI)
    expect(run.databaseUri).toBe(withDatabase(DEFAULT_SOURCE_URI, databaseNameFor(3020)))
  })
})

describe('resource names', () => {
  it('are unique per port', () => {
    const ports = [3020, 3021, 3022]
    const names = ports.flatMap((p) => [databaseNameFor(p), distDirFor(p), outputDirFor(p)])
    expect(new Set(names).size).toBe(names.length)
  })
})
