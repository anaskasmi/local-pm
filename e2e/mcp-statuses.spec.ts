import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { seedProject, statusKeyOf, getTicket, type SeedRefs } from './helpers'

let refs: SeedRefs
let mcp: McpClient

interface Rpc {
  id?: number
  result?: { isError?: boolean; content: { text: string }[]; tools?: { name: string }[] }
}

class McpClient {
  private proc: ChildProcessWithoutNullStreams
  private pending = new Map<number, (msg: Rpc) => void>()
  private buffer = ''
  private nextId = 0

  constructor(baseUrl: string) {
    this.proc = spawn(
      process.execPath,
      ['--import', 'tsx', 'mcp-server/src/index.ts'],
      { env: { ...process.env, LOCAL_PM_URL: baseUrl }, stdio: 'pipe' },
    ) as ChildProcessWithoutNullStreams

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk
      let cut = this.buffer.indexOf('\n')
      while (cut >= 0) {
        const line = this.buffer.slice(0, cut).trim()
        this.buffer = this.buffer.slice(cut + 1)
        if (line) {
          const message = JSON.parse(line) as Rpc
          const resolve = message.id !== undefined ? this.pending.get(message.id) : undefined
          if (resolve && message.id !== undefined) {
            this.pending.delete(message.id)
            resolve(message)
          }
        }
        cut = this.buffer.indexOf('\n')
      }
    })
  }

  private send(method: string, params: unknown): Promise<Rpc> {
    const id = (this.nextId += 1)
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  async start() {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    })
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  }

  async listTools() {
    const response = await this.send('tools/list', {})
    return response.result?.tools ?? []
  }

  async raw(name: string, args: Record<string, unknown>) {
    const response = await this.send('tools/call', { name, arguments: args })
    return response.result!
  }

  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.raw(name, args)
    if (result.isError) throw new Error(result.content[0].text)
    return JSON.parse(result.content[0].text) as T
  }

  stop() {
    this.proc.kill()
  }
}

interface StatusRow {
  id: string
  key: string
  name: string
  type: string
  order: number | null
  scope: 'workspace' | 'project'
}

test.beforeAll(async ({ request, baseURL }) => {
  refs = await seedProject(request, 'mcp-statuses')

  const created = await request.post('/api/statuses', {
    data: { name: 'In Review', type: 'STARTED', order: 2500, project: refs.projectId },
  })
  if (!created.ok()) {
    throw new Error(`Failed to create status: ${created.status()} ${await created.text()}`)
  }

  mcp = new McpClient(baseURL!)
  await mcp.start()
})

test.afterAll(() => {
  mcp?.stop()
})

test('no ticket tool advertises a fixed status enum', async () => {
  const tools = (await mcp.listTools()) as unknown as {
    name: string
    inputSchema: { properties?: Record<string, { enum?: unknown[] }> }
  }[]

  for (const name of ['list_tickets', 'create_ticket', 'update_ticket', 'move_ticket']) {
    const tool = tools.find((candidate) => candidate.name === name)
    expect(tool, `${name} should be advertised`).toBeDefined()
    expect(tool!.inputSchema.properties?.status?.enum, `${name} pins a status enum`).toBeUndefined()
  }
})

test('list_statuses returns the project workflow in column order', async () => {
  const workspace = await mcp.call<{ statuses: StatusRow[]; default: string }>('list_statuses', {})
  expect(workspace.statuses.map((row) => row.key)).toEqual(['todo', 'in_progress', 'done'])
  expect(workspace.statuses.every((row) => row.scope === 'workspace')).toBe(true)
  expect(workspace.default).toBe('todo')

  const scoped = await mcp.call<{ statuses: StatusRow[]; total: number }>('list_statuses', {
    projectId: refs.projectId,
  })
  expect(scoped.statuses.map((row) => row.key)).toEqual([
    'todo',
    'in_progress',
    'in_review',
    'done',
  ])
  expect(scoped.total).toBe(4)
  expect(scoped.statuses.find((row) => row.key === 'in_review')?.scope).toBe('project')
})

test('a ticket can be created in a status scoped to its own project', async ({ request }) => {
  const created = await mcp.call<{ doc: { id: string } }>('create_ticket', {
    title: 'Created in a custom status',
    project: refs.projectId,
    status: 'in_review',
  })

  const ticket = await getTicket(request, created.doc.id)
  expect(await statusKeyOf(request, ticket.status)).toBe('in_review')
})

test('move_ticket and update_ticket accept a project status by display name', async ({
  request,
}) => {
  const created = await mcp.call<{ doc: { id: string } }>('create_ticket', {
    title: 'Moved by name',
    project: refs.projectId,
  })
  const id = created.doc.id

  await mcp.call('move_ticket', { id, status: 'In Review' })
  expect(await statusKeyOf(request, (await getTicket(request, id)).status)).toBe('in_review')

  await mcp.call('update_ticket', { id, status: 'Done' })
  expect(await statusKeyOf(request, (await getTicket(request, id)).status)).toBe('done')
})

test('an unknown status is rejected and names the keys that were available', async () => {
  const created = await mcp.call<{ doc: { id: string } }>('create_ticket', {
    title: 'Rejects nonsense',
    project: refs.projectId,
  })

  const result = await mcp.raw('move_ticket', { id: created.doc.id, status: 'nonsense' })
  expect(result.isError).toBe(true)
  expect(result.content[0].text).toContain('Unknown status "nonsense"')
  expect(result.content[0].text).toContain('todo, in_progress, in_review, done')
})
