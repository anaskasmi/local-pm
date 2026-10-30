import { describe, expect, it, vi } from 'vitest'
import type { AfterErrorHookArgs, PayloadRequest } from 'payload'
import {
  TRANSIENT_RETRY_ATTEMPTS,
  TRANSIENT_TRANSACTION_LABEL,
  TRANSIENT_TRANSACTION_STATUS,
  isTransientTransactionError,
  markTransientTransaction,
  withTransientRetry,
} from '@/lib/transient-transaction'

const URL = 'http://localhost:3010/api/tickets/abc'
const context = { params: Promise.resolve({ slug: ['tickets', 'abc'] }) }
const ok = () => Response.json({ doc: { id: 'abc' } }, { status: 200 })
const transient = () => Response.json({ errors: [{ message: 'Something went wrong.' }], transient: true }, { status: 503 })
const plain503 = () => Response.json({ errors: [{ message: 'down' }] }, { status: 503 })

function hookArgs(error: Error): AfterErrorHookArgs {
  return {
    error,
    context: {},
    req: {} as PayloadRequest,
    result: { errors: [{ message: 'Something went wrong.' }] },
  }
}

describe('isTransientTransactionError', () => {
  it('reads the label from the error and from its server response', () => {
    expect(isTransientTransactionError({ errorLabels: [TRANSIENT_TRANSACTION_LABEL] })).toBe(true)
    expect(isTransientTransactionError({ errorResponse: { errorLabels: [TRANSIENT_TRANSACTION_LABEL] } })).toBe(true)
  })

  it('rejects any other error', () => {
    expect(isTransientTransactionError(new Error('validation'))).toBe(false)
    expect(isTransientTransactionError({ errorLabels: ['RetryableWriteError'] })).toBe(false)
    expect(isTransientTransactionError(null)).toBe(false)
  })
})

describe('markTransientTransaction', () => {
  it('turns a rolled-back transaction into a retryable 503', () => {
    const error = Object.assign(new Error('Transaction has been aborted.'), { errorLabels: [TRANSIENT_TRANSACTION_LABEL] })
    expect(markTransientTransaction(hookArgs(error))).toEqual({
      status: TRANSIENT_TRANSACTION_STATUS,
      response: { errors: [{ message: 'Something went wrong.' }], transient: true },
    })
  })

  it('leaves other errors untouched', () => {
    expect(markTransientTransaction(hookArgs(new Error('validation')))).toBeUndefined()
  })
})

describe('withTransientRetry', () => {
  it('replays a write with the same body until it commits', async () => {
    const bodies: string[] = []
    const handler = vi.fn(async (request: Request) => {
      bodies.push(await request.text())
      return bodies.length === 1 ? transient() : ok()
    })
    const response = await withTransientRetry(handler)(new Request(URL, { method: 'PATCH', body: '{"title":"x"}' }), context)
    expect(response.status).toBe(200)
    expect(bodies).toEqual(['{"title":"x"}', '{"title":"x"}'])
  })

  it('stops after the retry budget and returns the last failure', async () => {
    const handler = vi.fn(async () => transient())
    const response = await withTransientRetry(handler)(new Request(URL, { method: 'POST', body: '{}' }), context)
    expect(response.status).toBe(TRANSIENT_TRANSACTION_STATUS)
    expect(handler).toHaveBeenCalledTimes(1 + TRANSIENT_RETRY_ATTEMPTS)
  })

  it('does not retry a 503 that is not a rolled-back transaction', async () => {
    const handler = vi.fn(async () => plain503())
    await withTransientRetry(handler)(new Request(URL, { method: 'PATCH', body: '{}' }), context)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('passes reads straight through', async () => {
    const request = new Request(URL, { method: 'GET' })
    const handler = vi.fn(async () => transient())
    await withTransientRetry(handler)(request, context)
    expect(handler.mock.calls).toEqual([[request, context]])
  })
})
