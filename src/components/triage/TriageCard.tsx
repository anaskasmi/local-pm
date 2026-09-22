'use client'

import Link from 'next/link'
import { AlarmClock, Check, Copy, CornerDownRight, MoreHorizontal, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { ticketPriorityMeta } from '@/lib/status'
import { formatDateShort } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Member, Project, Ticket } from '@/payload-types'

function projectOf(ticket: Ticket): Project | null {
  return typeof ticket.project === 'object' && ticket.project ? ticket.project : null
}

function assigneeOf(ticket: Ticket): Member | null {
  return typeof ticket.assignee === 'object' && ticket.assignee ? ticket.assignee : null
}

export function TriageCard({
  ticket,
  focused,
  busy,
  onFocus,
  onAccept,
  onAcceptInto,
  onDuplicate,
  onDecline,
  onSnooze,
}: {
  ticket: Ticket
  focused: boolean
  busy: boolean
  onFocus: () => void
  onAccept: () => void
  onAcceptInto: () => void
  onDuplicate: () => void
  onDecline: () => void
  onSnooze: () => void
}) {
  const project = projectOf(ticket)
  const assignee = assigneeOf(ticket)
  const priority = ticketPriorityMeta(ticket.priority)
  const PriorityIcon = priority.icon

  const menuItems: MenuItem[] = [
    { id: 'accept', label: 'Accept', icon: Check, shortcut: '1', onSelect: onAccept },
    { id: 'accept-into', label: 'Accept into…', icon: CornerDownRight, onSelect: onAcceptInto },
    { id: 'duplicate', label: 'Mark as duplicate', icon: Copy, shortcut: '2', onSelect: onDuplicate },
    { id: 'snooze', label: 'Snooze', icon: AlarmClock, shortcut: 'h', onSelect: onSnooze },
    {
      id: 'decline',
      label: 'Decline',
      icon: X,
      destructive: true,
      separatorBefore: true,
      shortcut: '3',
      onSelect: onDecline,
    },
  ]

  return (
    <li>
      <article
        data-triage-card
        data-ticket-id={ticket.id}
        tabIndex={0}
        onFocus={onFocus}
        aria-busy={busy || undefined}
        className={cn(
          'flex flex-col gap-3 rounded-md border bg-surface p-3 transition-colors duration-micro',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          focused ? 'border-accent-border bg-accent-subtle/40' : 'border-border-subtle',
          busy && 'opacity-60',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <PriorityIcon
            className={cn('mt-0.5 size-4 shrink-0', priority.tone === 'neutral' ? 'text-text-muted' : '')}
            aria-hidden
          />

          <div className="min-w-0 flex-1">
            <Link
              href={`/tickets/${ticket.id}`}
              className="rounded-sm text-base font-medium text-text hover:text-accent-text"
            >
              <span className="line-clamp-2" title={ticket.title}>
                {ticket.title}
              </span>
            </Link>

            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
              {ticket.ticketId ? (
                <span className="font-medium tabular-nums">{ticket.ticketId}</span>
              ) : null}
              {project ? (
                <span className="truncate" title={project.name}>
                  {project.name}
                </span>
              ) : null}
              <span>{priority.label}</span>
              {ticket.snoozedUntil ? (
                <span className="flex items-center gap-1 text-warning-text">
                  <AlarmClock className="size-3.5" aria-hidden />
                  Until {formatDateShort(ticket.snoozedUntil)}
                </span>
              ) : null}
            </p>
          </div>

          {assignee ? <Avatar name={assignee.name} size="sm" /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={Check} onClick={onAccept} disabled={busy}>
            Accept
          </Button>
          <Button size="sm" variant="secondary" icon={Copy} onClick={onDuplicate} disabled={busy}>
            Duplicate
          </Button>
          <Button size="sm" variant="secondary" icon={X} onClick={onDecline} disabled={busy}>
            Decline
          </Button>
          <Button size="sm" variant="ghost" icon={AlarmClock} onClick={onSnooze} disabled={busy}>
            Snooze
          </Button>

          <div className="ml-auto">
            <Menu
              label={`Actions for ${ticket.title}`}
              items={menuItems}
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={MoreHorizontal}
                  aria-label={`Actions for ${ticket.title}`}
                />
              }
            />
          </div>
        </div>
      </article>
    </li>
  )
}
