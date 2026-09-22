'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { appendTicketSearch } from '@/lib/ticket-search'

export type EntityCollection = 'projects' | 'teams' | 'tickets' | 'members' | 'cycles' | 'labels'

export type WhereValue = string | null | undefined | { not_in: string[] }

export type EntityWhere = Record<string, WhereValue>

export interface EntityQueryOptions {
  collection: EntityCollection

  searchField: string

  sort: string

  where?: EntityWhere
  pageSize?: number
  depth?: number

  enabled?: boolean
}

export interface EntityQueryResult<T> {
  docs: T[]
  totalDocs: number
  hasNextPage: boolean
  loading: boolean

  loadingMore: boolean
  error: string | null
  loadMore: () => void
  retry: () => void
}

const DEBOUNCE_MS = 300

export function useEntityQuery<T extends { id: string }>(
  query: string,
  options: EntityQueryOptions,
): EntityQueryResult<T> {
  const { collection, searchField, sort, where, pageSize = 20, depth = 0, enabled = true } = options

  const [docs, setDocs] = useState<T[]>([])
  const [page, setPage] = useState(1)
  const [totalDocs, setTotalDocs] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const whereKey = JSON.stringify(where ?? {})
  const loadingMoreRef = useRef(false)

  const buildUrl = useCallback(
    (targetPage: number, search: string) => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        page: String(targetPage),
        sort,
        depth: String(depth),
      })
      const trimmed = search.trim()
      if (collection === 'tickets') appendTicketSearch(params, trimmed)
      else if (trimmed) params.set(`where[${searchField}][like]`, trimmed)
      for (const [field, value] of Object.entries((JSON.parse(whereKey) ?? {}) as EntityWhere)) {
        if (typeof value === 'string') {
          if (value) params.set(`where[${field}][equals]`, value)
        } else if (value && value.not_in.length > 0) {
          params.set(`where[${field}][not_in]`, value.not_in.join(','))
        }
      }
      return `/api/${collection}?${params}`
    },
    [collection, depth, pageSize, searchField, sort, whereKey],
  )

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(buildUrl(1, query), { signal: controller.signal })
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        const data = await response.json()
        setDocs((data.docs ?? []) as T[])
        setPage(data.page ?? 1)
        setTotalDocs(data.totalDocs ?? 0)
        setHasNextPage(Boolean(data.hasNextPage))
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'The request failed.')
        setDocs([])
        setHasNextPage(false)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    const timer = setTimeout(run, query ? DEBOUNCE_MS : 0)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [buildUrl, query, enabled, nonce])

  const loadMore = useCallback(() => {
    if (!enabled || !hasNextPage || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)

    void (async () => {
      try {
        const response = await fetch(buildUrl(page + 1, query))
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        const data = await response.json()
        const incoming = (data.docs ?? []) as T[]
        setDocs((prev) => {
          const seen = new Set(prev.map((d) => d.id))
          return [...prev, ...incoming.filter((d) => !seen.has(d.id))]
        })
        setPage(data.page ?? page + 1)
        setTotalDocs(data.totalDocs ?? 0)
        setHasNextPage(Boolean(data.hasNextPage))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The request failed.')
      } finally {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    })()
  }, [buildUrl, enabled, hasNextPage, page, query])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { docs, totalDocs, hasNextPage, loading, loadingMore, error, loadMore, retry }
}
