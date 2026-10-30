import type { AfterErrorHook } from 'payload'

export const TRANSIENT_TRANSACTION_LABEL = 'TransientTransactionError'
export const TRANSIENT_TRANSACTION_STATUS = 503
export const TRANSIENT_RETRY_ATTEMPTS = 2
export const TRANSIENT_RETRY_DELAY_MS = 250

const RETRYABLE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

type RouteContext = { params: Promise<{ slug?: string[] }> }
type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>

/**
 * Atlas aborts a transaction on a write conflict or when it outlives its 60 s
 * lifetime, and labels the error TransientTransactionError: the whole
 * operation, not just the commit, has to run again.
 */
export function isTransientTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const labels = (error as { errorLabels?: unknown }).errorLabels
  if (Array.isArray(labels) && labels.includes(TRANSIENT_TRANSACTION_LABEL)) return true
  const response = (error as { errorResponse?: { errorLabels?: unknown } }).errorResponse
  return Array.isArray(response?.errorLabels) && response.errorLabels.includes(TRANSIENT_TRANSACTION_LABEL)
}

export const markTransientTransaction: AfterErrorHook = ({ error, result }) => {
  if (!isTransientTransactionError(error)) return
  return { status: TRANSIENT_TRANSACTION_STATUS, response: { ...result, transient: true } }
}

async function isTransientResponse(response: Response): Promise<boolean> {
  if (response.status !== TRANSIENT_TRANSACTION_STATUS) return false
  const body: unknown = await response.clone().json().catch(() => null)
  return typeof body === 'object' && body !== null && (body as { transient?: unknown }).transient === true
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Replays a write the database rolled back. The body is buffered once so every
 * attempt sends the same bytes; attempts run one after another on the same
 * server, so a retry never opens a connection of its own.
 */
export function withTransientRetry(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    if (!RETRYABLE_METHODS.has(request.method)) return handler(request, context)

    const body = request.body === null ? null : await request.arrayBuffer()
    const attempt = () =>
      handler(new Request(request.url, { method: request.method, headers: request.headers, body }), context)

    let response = await attempt()
    for (let retry = 1; retry <= TRANSIENT_RETRY_ATTEMPTS && (await isTransientResponse(response)); retry += 1) {
      await wait(TRANSIENT_RETRY_DELAY_MS * retry)
      response = await attempt()
    }
    return response
  }
}
