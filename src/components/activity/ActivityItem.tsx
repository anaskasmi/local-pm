'use client'

import {
  AlarmClock,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  CircleDot,
  Copy,
  CornerDownRight,
  Diamond,
  FileText,
  FolderClosed,
  Layers,
  ListChecks,
  MessageSquare,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  SignalHigh,
  Tag,
  Trash2,
  Type,
  Unlink,
  UserRound,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { describeEvent, isCommentAction, type TrackedField } from '@/lib/activity'
import { formatDateTime, formatDateTimeRelative } from '@/lib/format'
import { Avatar } from '@/components/ui/Avatar'
import type { Activity, Member } from '@/payload-types'

type IconType = typeof CircleDot

const FIELD_ICONS: Record<TrackedField, IconType> = {
  title: Type,
  status: CircleDot,
  priority: SignalHigh,
  assignee: UserRound,
  project: FolderClosed,
  team: Users,
  cycle: Repeat,
  estimate: Diamond,
  startDate: CalendarRange,
  dueDate: CalendarDays,
  snoozedUntil: AlarmClock,
  duplicateOf: Copy,
  description: FileText,
  labels: Tag,
  blockedBy: Unlink,
  subtasks: ListChecks,
  epic: Layers,
}

const ACTION_ICONS: Record<string, IconType> = {
  created: Plus,
  commented: MessageSquare,
  replied: CornerDownRight,
  edited: Pencil,
  resolved: CheckCircle2,
  reopened: RotateCcw,
  deleted: Trash2,
}

function iconFor(entry: Activity): IconType {
  const byAction = ACTION_ICONS[entry.action]
  if (byAction) return byAction
  return FIELD_ICONS[entry.field as TrackedField] ?? CircleDot
}

export function actorOf(entry: Activity): Member | null {
  const actor = entry.actor
  return actor && typeof actor === 'object' ? (actor as Member) : null
}

function quoteFor(entry: Activity): string | null {
  if (!isCommentAction(entry.action)) return null
  const text = entry.action === 'deleted' ? entry.from : entry.to
  return typeof text === 'string' && text.trim() ? text : null
}

export function ActivityGroup({ entries }: { entries: Activity[] }) {
  const first = entries[0]
  if (!first) return null

  const actor = actorOf(first)
  const name = actor?.name ?? 'Somebody'

  return (
    <li className="flex min-w-0 gap-3">
      <Avatar name={actor?.name ?? null} seed={actor?.id} size="sm" decorative className="mt-0.5" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="min-w-0 text-sm text-text-muted">
          <span className="font-medium text-text">{name}</span>{' '}
          <time dateTime={first.createdAt} title={formatDateTime(first.createdAt)}>
            {formatDateTimeRelative(first.createdAt)}
          </time>
        </p>

        <ul className="flex min-w-0 flex-col gap-1">
          {entries.map((entry) => {
            const Icon = iconFor(entry)
            return (
              <li
                key={entry.id}
                data-activity-field={entry.field ?? entry.action}
                className="flex min-w-0 items-start gap-2 text-sm text-text-muted"
              >
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  {describeEvent(entry)}
                  {quoteFor(entry) && (
                    <span className="text-text-muted/80">
                      {': '}
                      <q className="italic">{quoteFor(entry)}</q>
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </li>
  )
}

export function ActivityList({ groups, className }: { groups: Activity[][]; className?: string }) {
  return (
    <ul className={cn('flex min-w-0 flex-col gap-4', className)}>
      {groups.map((group) => (
        <ActivityGroup key={group[0].id} entries={group} />
      ))}
    </ul>
  )
}
