'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlarmClock, Check, Inbox, Settings2 } from 'lucide-react'
import { Button, LinkButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProjectSelect } from '@/components/ui/EntityPickers'
import { Kbd } from '@/components/ui/Kbd'
import { useToast } from '@/components/ui/Toast'
import { useShortcut } from '@/lib/shortcuts'
import { cn } from '@/lib/cn'
import type { Status, Ticket } from '@/payload-types'
import { TriageCard } from './TriageCard'
import { TriageResolveDialog, type DialogMode } from './TriageResolveDialog'

export interface TriageQueueViewProps {
  pending: Ticket[]
  snoozed: Ticket[]
  workflow: Pick<Status, 'id' | 'name' | 'key' | 'type'>[]
  enabled: boolean
  projectFilter: string | null
  showSnoozed: boolean
  hasProjects: boolean
}

export function TriageQueueView({
  pending,
  snoozed,
  workflow,
  enabled,
  projectFilter,
  showSnoozed,
  hasProjects,
}: TriageQueueViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const tickets = showSnoozed ? snoozed : pending
  const [focusIndex, setFocusIndex] = useState(0)
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    setFocusIndex((index) => Math.min(index, Math.max(tickets.length - 1, 0)))
  }, [tickets.length])

  const focused = tickets[focusIndex] ?? null

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (value) next.set(key, value)
      else next.delete(key)
      router.push(next.toString() ? `/triage?${next}` : '/triage')
    },
    [router, searchParams],
  )

  const resolve = useCallback(
    async (ticket: Ticket, body: Record<string, unknown>, done: string) => {
      setBusyId(String(ticket.id))
      try {
        const response = await fetch(`/api/tickets/${ticket.id}/triage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(payload?.error || `${response.status} ${response.statusText}`)
        }

        toast({ tone: 'success', title: done, description: ticket.title })
        setDialog(null)
        router.refresh()
        return true
      } catch (error) {
        toast({
          tone: 'error',
          title: "Couldn't resolve this",
          description: error instanceof Error ? error.message : undefined,
        })
        return false
      } finally {
        setBusyId(null)
      }
    },
    [router, toast],
  )

  const acceptNow = useCallback(
    (ticket: Ticket | null) => {
      if (!ticket) return
      void resolve(ticket, { resolution: 'accept' }, 'Accepted')
    },
    [resolve],
  )

  const scope = 'list' as const
  const active = Boolean(focused) && !dialog

  useShortcut({
    id: 'triage.accept',
    keys: '1',
    description: 'Accept the focused item',
    group: 'Triage',
    scope,
    enabled: active,
    run: () => acceptNow(focused),
  })
  useShortcut({
    id: 'triage.duplicate',
    keys: '2',
    description: 'Mark the focused item as a duplicate',
    group: 'Triage',
    scope,
    enabled: active,
    run: () => focused && setDialog({ kind: 'duplicate', ticket: focused }),
  })
  useShortcut({
    id: 'triage.decline',
    keys: '3',
    description: 'Decline the focused item',
    group: 'Triage',
    scope,
    enabled: active,
    run: () => focused && setDialog({ kind: 'decline', ticket: focused }),
  })
  useShortcut({
    id: 'triage.snooze',
    keys: 'h',
    description: 'Snooze the focused item',
    group: 'Triage',
    scope,
    enabled: active,
    run: () => focused && setDialog({ kind: 'snooze', ticket: focused }),
  })
  useShortcut({
    id: 'triage.next',
    keys: 'j',
    description: 'Focus the next item',
    group: 'Triage',
    scope,
    enabled: tickets.length > 1 && !dialog,
    run: () => setFocusIndex((index) => Math.min(index + 1, tickets.length - 1)),
  })
  useShortcut({
    id: 'triage.previous',
    keys: 'k',
    description: 'Focus the previous item',
    group: 'Triage',
    scope,
    enabled: tickets.length > 1 && !dialog,
    run: () => setFocusIndex((index) => Math.max(index - 1, 0)),
  })

  useEffect(() => {
    const node = listRef.current?.querySelectorAll('[data-triage-card]')[focusIndex]
    if (node instanceof HTMLElement) node.focus()
  }, [focusIndex])

  const counts = useMemo(
    () => ({ pending: pending.length, snoozed: snoozed.length }),
    [pending.length, snoozed.length],
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-none flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Inbox className="size-5 text-warning-text" aria-hidden />
          Triage
        </h1>

        <div className="flex items-center gap-1 rounded-sm border border-border bg-surface p-0.5">
          <TabButton
            active={!showSnoozed}
            onClick={() => setParam('show', null)}
            count={counts.pending}
          >
            Pending
          </TabButton>
          <TabButton
            active={showSnoozed}
            onClick={() => setParam('show', 'snoozed')}
            count={counts.snoozed}
          >
            Snoozed
          </TabButton>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="w-56">
            <ProjectSelect
              value={projectFilter ?? ''}
              onChange={(value) => setParam('project', value || null)}
              allLabel="All projects"
              placeholder="All projects"
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {!enabled ? (
          <EmptyState
            kind="no-data"
            icon={Settings2}
            title="Triage is off for this project"
            description="Turn triage on in project settings and incoming work will wait here until someone accepts, declines or merges it."
          >
            {hasProjects && projectFilter ? (
              <LinkButton href={`/projects/${projectFilter}?tab=triage`} variant="primary">
                Open project settings
              </LinkButton>
            ) : (
              <LinkButton href="/projects" variant="primary">
                Choose a project
              </LinkButton>
            )}
          </EmptyState>
        ) : tickets.length === 0 ? (
          <EmptyState
            kind={showSnoozed ? 'no-match' : 'no-data'}
            icon={showSnoozed ? AlarmClock : Check}
            title={showSnoozed ? 'Nothing snoozed' : 'Triage is clear'}
            description={
              showSnoozed
                ? 'Snoozed items come back here on their date, or sooner if someone comments or changes them.'
                : 'Every incoming item has been resolved. New work filed into this project will appear here.'
            }
          />
        ) : (
          <>
            <ul ref={listRef} className="flex flex-col gap-2" aria-label="Triage queue">
              {tickets.map((ticket, index) => (
                <TriageCard
                  key={ticket.id}
                  ticket={ticket}
                  focused={index === focusIndex}
                  busy={busyId === String(ticket.id)}
                  onFocus={() => setFocusIndex(index)}
                  onAccept={() => acceptNow(ticket)}
                  onAcceptInto={() => setDialog({ kind: 'accept', ticket })}
                  onDuplicate={() => setDialog({ kind: 'duplicate', ticket })}
                  onDecline={() => setDialog({ kind: 'decline', ticket })}
                  onSnooze={() => setDialog({ kind: 'snooze', ticket })}
                />
              ))}
            </ul>

            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <Kbd keys="1" /> Accept
              </span>
              <span className="flex items-center gap-1">
                <Kbd keys="2" /> Duplicate
              </span>
              <span className="flex items-center gap-1">
                <Kbd keys="3" /> Decline
              </span>
              <span className="flex items-center gap-1">
                <Kbd keys="h" /> Snooze
              </span>
              <span className="flex items-center gap-1">
                <Kbd keys="j" /> <Kbd keys="k" /> Move
              </span>
            </p>
          </>
        )}
      </div>

      {dialog ? (
        <TriageResolveDialog
          mode={dialog}
          workflow={workflow}
          busy={busyId !== null}
          onClose={() => setDialog(null)}
          onSubmit={(body, done) => resolve(dialog.ticket, body, done)}
        />
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-sm font-medium transition-colors duration-micro',
        active ? 'bg-accent-subtle text-accent-text' : 'text-text-muted hover:bg-surface-hover',
      )}
    >
      {children}
      <span className="tabular-nums text-xs">{count}</span>
    </button>
  )
}
