import os from 'node:os'
import path from 'node:path'
import { DEFAULT_MONGO_PORT_BASE, parsePort } from './run-context'

process.env.MONGOMS_VERSION ??= '7.0.14'
process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(os.homedir(), '.cache', 'mongodb-binaries')

const port = parsePort(process.env.E2E_MONGO_PORT) ?? DEFAULT_MONGO_PORT_BASE

const { MongoMemoryReplSet } = await import('mongodb-memory-server')

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
  instanceOpts: [{ port }],
})

console.log(`[e2e] mongod ready on ${replSet.getUri()}`)

let stopping = false

const stop = async (signal: string) => {
  if (stopping) return
  stopping = true
  console.log(`[e2e] mongod stopping on ${signal}`)
  await replSet.stop()
  process.exit(0)
}

process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
process.on('SIGHUP', () => void stop('SIGHUP'))
