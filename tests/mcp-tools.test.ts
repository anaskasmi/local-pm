import { describe, it, expect } from 'vitest'
import { tools } from '../mcp-server/src/tools'

function tool(name: string) {
  const found = tools.find((t) => t.name === name)
  if (!found) throw new Error(`No MCP tool named ${name}`)
  return found
}

function statusField(name: string) {
  const properties = tool(name).inputSchema.properties as
    | Record<string, { enum?: unknown[]; description?: string }>
    | undefined
  return properties?.status
}

const TICKET_STATUS_TOOLS = ['list_tickets', 'create_ticket', 'update_ticket', 'move_ticket']

describe('MCP ticket status schemas', () => {
  it.each(TICKET_STATUS_TOOLS)('%s declares status as an open string', (name) => {
    const field = statusField(name)
    expect(field).toBeDefined()
    expect(field?.enum).toBeUndefined()
  })

  it.each(TICKET_STATUS_TOOLS)('%s points the caller at list_statuses', (name) => {
    expect(statusField(name)?.description).toContain('list_statuses')
  })

  it('no tool pins the pre-configurable three statuses', () => {
    const pinned = tools.filter((t) =>
      JSON.stringify(t.inputSchema).includes('"todo","in_progress","done"'),
    )
    expect(pinned.map((t) => t.name)).toEqual([])
  })

  it('create_ticket does not default to a status key that may not exist', () => {
    const properties = tool('create_ticket').inputSchema.properties as Record<
      string,
      { default?: unknown }
    >
    expect(properties.status.default).toBeUndefined()
  })
})

describe('list_statuses', () => {
  it('is registered', () => {
    expect(tools.map((t) => t.name)).toContain('list_statuses')
  })

  it('takes an optional projectId and requires nothing', () => {
    const schema = tool('list_statuses').inputSchema
    expect(Object.keys(schema.properties ?? {})).toEqual(['projectId'])
    expect(schema.required ?? []).toEqual([])
  })
})
