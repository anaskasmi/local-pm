import config from '@payload-config'
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from '@payloadcms/next/routes'
import { withTransientRetry } from '@/lib/transient-transaction'

export const GET = REST_GET(config)
export const POST = withTransientRetry(REST_POST(config))
export const DELETE = withTransientRetry(REST_DELETE(config))
export const PATCH = withTransientRetry(REST_PATCH(config))
export const PUT = withTransientRetry(REST_PUT(config))
export const OPTIONS = REST_OPTIONS(config)
