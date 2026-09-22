'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ListFilter, Loader2, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDateCompact } from '@/lib/format'
import { statusOptions, isClosedStatus } from '@/lib/status'
import { useEntityQuery } from '@/hooks/useEntityQuery'
import { AvatarLabel } from '@/components/ui/Avatar'
import { Button, LinkButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { estimatesFor } from '@/components/ui/EstimatePicker'
import { estimateLabel } from '@/lib/estimates'
import { Kbd } from '@/components/ui/Kbd'
import { Select } from '@/components/ui/Select'
import { RowSkeletonList, useDelayedFlag } from '@/components/ui/Skeleton'
import { PriorityIndicator, TicketStatusBadge } from '@/components/ui/StateIndicator'
import { TicketKey } from '@/components/ui/EntityMark'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import type { Member, Project, Team, Ticket } from '@/payload-types'
import { splitWorkflow } from '@/lib/triage'
import { useWorkflow } from '@/components/shell/WorkflowProvider'

type SortKey = 'sortOrder' | 'title' | '-title' | '-createdAt' | 'createdAt' | 'dueDate'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'sortOrder', label: 'Board order' },
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: '-title', label: 'Title Z–A' },
  { value: 'dueDate', label: 'Due date' },
]

export interface TicketsTableProps {
  where: Record<string, string | null | undefined>
  caption: string
  keyColor?: string | null
  newTicketHref?: string
  emptyTitle: string
  emptyDescription: string
  relationColumn: 'team' | 'project'
}

export function TicketsTable({
  where,
  caption,
  keyColor,
  newTicketHref,
  emptyTitle,
  emptyDescription,
  relationColumn,
}: TicketsTableProps) {
  const { statuses: allStatuses, statusesForProject } = useWorkflow()
  const scoped = useMemo(
    () => (where.project ? statusesForProject(where.project) : allStatuses),
    [where.project, statusesForProject, allStatuses],
  )
  const { triage: triageStatuses, workflow: statuses } = useMemo(
    () => splitWorkflow(scoped),
    [scoped],
  )
  const triageIds = useMemo(
    () => triageStatuses.map((entry) => entry.id),
    [triageStatuses],
  )
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('')
  const [sort, setSort] = useState<SortKey>('sortOrder')

  const { docs, totalDocs, hasNextPage, loading, loadingMore, error, loadMore, retry } =
    useEntityQuery<Ticket>(query, {
      collection: 'tickets',
      searchField: 'title',
      sort,
      where: {
        ...where,
        status: status || (triageIds.length > 0 ? { not_in: triageIds } : undefined),
      },
      depth: 1,
      pageSize: 25,
    })

  const showSkeleton = useDelayedFlag(loading)
  const hasFilters = Boolean(query || status)
  const showEstimates = useMemo(
    () =>
      docs.some(
        (ticket) =>
          estimatesFor(typeof ticket.project === 'object' ? (ticket.project as Project) : null)
            .enabled,
      ),
    [docs],
  )

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search)
      setQuery(params.get('ticketQ') ?? '')
      const status = params.get('ticketStatus')
      setStatus(statuses.some((entry) => entry.id === status) ? status! : '')
      const sort = params.get('ticketSort')
      setSort(SORTS.some((item) => item.value === sort) ? (sort as SortKey) : 'sortOrder')
    }
    restore()
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [statuses])

  const update = (patch: Partial<{ query: string; status: string; sort: SortKey }>) => {
    const next = { query, status, sort, ...patch }
    setQuery(next.query)
    setStatus(next.status)
    setSort(next.sort)
    const params = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries({
      ticketQ: next.query,
      ticketStatus: next.status,
      ticketSort: next.sort === 'sortOrder' ? '' : next.sort,
    })) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const url = window.location.pathname + (params.size ? '?' + params : '') + window.location.hash
    if ('query' in patch) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
  }
  const clearFilters = () => update({ query: '', status: '' })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex h-8 min-w-44 flex-1 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 md:max-w-72">
          <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
          <span className="sr-only">Search these tickets</span>
          <input
            type="search"
            value={query}
            onChange={(e) => update({ query: e.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') update({ query: '' })
            }}
            placeholder="Search by title or ticket key"
            className="min-w-0 flex-1 bg-transparent text-base text-text outline-none max-sm:text-md"
          />
          {loading && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-text-muted" aria-hidden />
          )}
        </label>

        <Select
          aria-label="Filter by status"
          value={status}
          onValueChange={(next) => update({ status: next })}
          className="w-40 max-sm:w-full"
          options={[
            { value: '', label: 'All statuses', icon: ListFilter },
            ...statusOptions(statuses),
          ]}
        />

        <Select
          aria-label="Sort tickets"
          value={sort}
          onValueChange={(next) => update({ sort: next as SortKey })}
          className="w-44 max-sm:w-full"
          options={SORTS}
        />

        {newTicketHref && (
          <LinkButton
            variant="primary"
            icon={Plus}
            href={newTicketHref}
            className="ml-auto max-sm:w-full"
          >
            New ticket
            <Kbd keys="c" tone="inverse" className="ml-1.5" />
          </LinkButton>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted tabular" aria-live="polite">
          {totalDocs} {totalDocs === 1 ? 'ticket' : 'tickets'}
        </span>

        {status && (
          <Chip
            tone="accent"
            onRemove={() => update({ status: '' })}
            removeLabel="Remove status filter"
          >
            Status: {statusOptions(statuses).find((o) => o.value === status)?.label}
          </Chip>
        )}
        {query && (
          <Chip tone="accent" onRemove={() => update({ query: '' })} removeLabel="Clear the search">
            Search: {query}
          </Chip>
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>
            Clear all
          </Button>
        )}
      </div>

      {error ? (
        <EmptyState
          kind="error"
          title="Couldn't load these tickets"
          description={error}
          action={{ label: 'Retry', onClick: retry }}
        />
      ) : showSkeleton && docs.length === 0 ? (
        <RowSkeletonList count={5} />
      ) : docs.length === 0 && hasFilters ? (
        <EmptyState
          kind="no-match"
          compact
          title="No tickets match"
          description="Nothing here fits the current search and status."
          action={{ label: 'Clear filters', onClick: clearFilters }}
        />
      ) : docs.length === 0 ? (
        <EmptyState
          kind="no-data"
          compact
          title={emptyTitle}
          description={emptyDescription}
          action={
            newTicketHref
              ? { label: 'Create the first ticket', onClick: () => router.push(newTicketHref) }
              : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-border-subtle">
            <Table caption={caption}>
              <thead>
                <tr>
                  <Th className="w-px whitespace-nowrap">Key</Th>
                  <Th className="w-px whitespace-nowrap">
                    <span className="sr-only">Priority</span>
                  </Th>
                  <Th>Title</Th>
                  <Th width="9rem">Status</Th>
                  <Th width="12rem">{relationColumn === 'team' ? 'Team' : 'Project'}</Th>
                  <Th width="11rem">Assignee</Th>
                  {showEstimates && (
                    <Th width="6rem" align="right">
                      Estimate
                    </Th>
                  )}
                  <Th width="8rem">Due</Th>
                </tr>
              </thead>
              <tbody>
                {docs.map((ticket) => {
                  const relation =
                    relationColumn === 'team'
                      ? typeof ticket.team === 'object'
                        ? (ticket.team as Team)
                        : null
                      : typeof ticket.project === 'object'
                        ? (ticket.project as Project)
                        : null
                  const assignee =
                    typeof ticket.assignee === 'object' ? (ticket.assignee as Member) : null
                  const overdue =
                    ticket.dueDate &&
                    !isClosedStatus(ticket.status) &&
                    new Date(ticket.dueDate).getTime() < Date.now()

                  return (
                    <Tr key={ticket.id} onOpen={() => router.push(`/tickets/${ticket.id}`)}>
                      <Td className="whitespace-nowrap">
                        <TicketKey
                          value={ticket.ticketId}
                          color={
                            keyColor ??
                            (typeof ticket.project === 'object'
                              ? (ticket.project as Project).color
                              : null)
                          }
                        />
                      </Td>
                      <Td>
                        <PriorityIndicator priority={ticket.priority} />
                      </Td>
                      <Td>
                        <Link
                          href={`/tickets/${ticket.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate font-medium text-text hover:underline"
                          title={ticket.title}
                        >
                          {ticket.title}
                        </Link>
                      </Td>
                      <Td>
                        <TicketStatusBadge status={ticket.status} />
                      </Td>
                      <Td className="truncate text-text-muted">{relation?.name ?? '—'}</Td>
                      <Td className="text-text">
                        <AvatarLabel
                          name={assignee?.name}
                          seed={assignee?.id}
                          fallback="Unassigned"
                        />
                      </Td>
                      {showEstimates && (
                        <Td align="right" className="text-text-muted">
                          {estimateLabel(
                            estimatesFor(
                              typeof ticket.project === 'object'
                                ? (ticket.project as Project)
                                : null,
                            ).scale,
                            ticket.estimate,
                          ) ?? '—'}
                        </Td>
                      )}
                      <Td
                        className={cn(
                          'whitespace-nowrap tabular',
                          overdue ? 'font-medium text-danger-text' : 'text-text-muted',
                        )}
                      >
                        {ticket.dueDate ? formatDateCompact(ticket.dueDate) : '—'}
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>

          {hasNextPage && (
            <div className="flex justify-center py-3">
              <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Loading…' : `Load more (${docs.length} of ${totalDocs})`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
