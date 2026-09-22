import {
  Ban,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  Inbox,
  PauseCircle,
  Timer,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  PriorityHigh,
  PriorityLow,
  PriorityMedium,
  PriorityNone,
  PriorityUrgent,
} from '@/components/ui/icons/Priority'
import { InitiativeStatus, ProjectStatus, StatusType, TicketPriority } from '@/types/enums'
import { statusTypeOf } from '@/lib/workflow'
import type { Status } from '@/payload-types'

export { statusTypeOf }

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'

export type StateIcon = LucideIcon | React.ComponentType<{ className?: string }>

export interface StateMeta {
  value: string
  label: string
  icon: StateIcon
  tone: Tone
}

export const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-neutral-subtle text-neutral-text border-neutral-border/60',
  info: 'bg-info-subtle text-info-text border-info-border/60',
  success: 'bg-success-subtle text-success-text border-success-border/60',
  warning: 'bg-warning-subtle text-warning-text border-warning-border/60',
  danger: 'bg-danger-subtle text-danger-text border-danger-border/60',
  accent: 'bg-accent-subtle text-accent-text border-accent-border/60',
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text-muted',
  info: 'text-info-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  accent: 'text-accent-text',
}

export const STATUS_TYPE_META: Record<StatusType, { icon: StateIcon; tone: Tone }> = {
  [StatusType.TRIAGE]: { icon: Inbox, tone: 'warning' },
  [StatusType.BACKLOG]: { icon: CircleDashed, tone: 'neutral' },
  [StatusType.UNSTARTED]: { icon: Circle, tone: 'neutral' },
  [StatusType.STARTED]: { icon: Timer, tone: 'info' },
  [StatusType.COMPLETED]: { icon: CheckCircle2, tone: 'success' },
  [StatusType.CANCELLED]: { icon: XCircle, tone: 'neutral' },
}

export const OPEN_STATUS_TYPES: StatusType[] = [
  StatusType.BACKLOG,
  StatusType.UNSTARTED,
  StatusType.STARTED,
]

export function statusTypeMeta(type: string | null | undefined): { icon: StateIcon; tone: Tone } {
  return STATUS_TYPE_META[type as StatusType] ?? STATUS_TYPE_META[StatusType.UNSTARTED]
}

export function isOpenStatusType(type: string | null | undefined): boolean {
  return OPEN_STATUS_TYPES.includes(type as StatusType)
}

export const FALLBACK_STATUS_META: StateMeta = {
  value: 'todo',
  label: 'Todo',
  icon: Circle,
  tone: 'neutral',
}

export function statusMeta(status: Status | string | null | undefined): StateMeta {
  if (!status || typeof status === 'string') return FALLBACK_STATUS_META
  const { icon, tone } = statusTypeMeta(status.type)
  return { value: status.key, label: status.name, icon, tone }
}

export const CLOSED_STATUS_TYPES: StatusType[] = [StatusType.COMPLETED, StatusType.CANCELLED]

export function isClosedStatus(status: Status | string | null | undefined): boolean {
  const type = statusTypeOf(status)
  return type ? CLOSED_STATUS_TYPES.includes(type as StatusType) : false
}

export function statusOptions(statuses: Status[]): StateSelectOption[] {
  return [...statuses]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((status) => {
      const { icon, tone } = statusTypeMeta(status.type)
      return { value: status.id, label: status.name, icon, tone }
    })
}

export interface PriorityMeta extends StateMeta {
  rank: number
}

export const TICKET_PRIORITY_META: Record<TicketPriority, PriorityMeta> = {
  [TicketPriority.URGENT]: {
    value: TicketPriority.URGENT,
    label: 'Urgent',
    rank: 4,
    icon: PriorityUrgent,
    tone: 'danger',
  },
  [TicketPriority.HIGH]: {
    value: TicketPriority.HIGH,
    label: 'High',
    rank: 3,
    icon: PriorityHigh,
    tone: 'warning',
  },
  [TicketPriority.MEDIUM]: {
    value: TicketPriority.MEDIUM,
    label: 'Medium',
    rank: 2,
    icon: PriorityMedium,
    tone: 'info',
  },
  [TicketPriority.LOW]: {
    value: TicketPriority.LOW,
    label: 'Low',
    rank: 1,
    icon: PriorityLow,
    tone: 'neutral',
  },
  [TicketPriority.NO_PRIORITY]: {
    value: TicketPriority.NO_PRIORITY,
    label: 'No priority',
    rank: 0,
    icon: PriorityNone,
    tone: 'neutral',
  },
}

export function ticketPriorityMeta(priority: string | null | undefined): PriorityMeta {
  return (
    TICKET_PRIORITY_META[priority as TicketPriority] ??
    TICKET_PRIORITY_META[TicketPriority.NO_PRIORITY]
  )
}

export const PROJECT_STATUS_META: Record<ProjectStatus, StateMeta> = {
  [ProjectStatus.ACTIVE]: {
    value: ProjectStatus.ACTIVE,
    label: 'Active',
    icon: CircleDot,
    tone: 'success',
  },
  [ProjectStatus.ON_HOLD]: {
    value: ProjectStatus.ON_HOLD,
    label: 'On Hold',
    icon: PauseCircle,
    tone: 'warning',
  },
  [ProjectStatus.COMPLETED]: {
    value: ProjectStatus.COMPLETED,
    label: 'Completed',
    icon: Check,
    tone: 'info',
  },
  [ProjectStatus.CANCELLED]: {
    value: ProjectStatus.CANCELLED,
    label: 'Cancelled',
    icon: XCircle,
    tone: 'neutral',
  },
}

export function projectStatusMeta(status: string | null | undefined): StateMeta {
  return PROJECT_STATUS_META[status as ProjectStatus] ?? PROJECT_STATUS_META[ProjectStatus.ACTIVE]
}

export const INITIATIVE_STATUS_META: Record<InitiativeStatus, StateMeta> = {
  [InitiativeStatus.PLANNED]: {
    value: InitiativeStatus.PLANNED,
    label: 'Planned',
    icon: CircleDashed,
    tone: 'neutral',
  },
  [InitiativeStatus.ACTIVE]: {
    value: InitiativeStatus.ACTIVE,
    label: 'Active',
    icon: CircleDot,
    tone: 'success',
  },
  [InitiativeStatus.COMPLETED]: {
    value: InitiativeStatus.COMPLETED,
    label: 'Completed',
    icon: Check,
    tone: 'info',
  },
  [InitiativeStatus.CANCELLED]: {
    value: InitiativeStatus.CANCELLED,
    label: 'Cancelled',
    icon: XCircle,
    tone: 'neutral',
  },
}

export function initiativeStatusMeta(status: string | null | undefined): StateMeta {
  return (
    INITIATIVE_STATUS_META[status as InitiativeStatus] ??
    INITIATIVE_STATUS_META[InitiativeStatus.PLANNED]
  )
}

export const BLOCKED_META: StateMeta = {
  value: 'BLOCKED',
  label: 'Blocked',
  icon: Ban,
  tone: 'warning',
}

export interface StateSelectOption {
  value: string
  label: string
  icon?: StateIcon
  tone?: Tone
}

export function ticketPriorityOptions(): StateSelectOption[] {
  return Object.values(TICKET_PRIORITY_META)
    .sort((a, b) => b.rank - a.rank)
    .map((meta) => ({
      value: meta.value,
      label: meta.label,
      icon: meta.icon,
      tone: meta.tone,
    }))
}

export function projectStatusOptions(): StateSelectOption[] {
  return Object.values(PROJECT_STATUS_META).map((meta) => ({
    value: meta.value,
    label: meta.label,
    icon: meta.icon,
    tone: meta.tone,
  }))
}

export function initiativeStatusOptions(): StateSelectOption[] {
  return Object.values(INITIATIVE_STATUS_META).map((meta) => ({
    value: meta.value,
    label: meta.label,
    icon: meta.icon,
    tone: meta.tone,
  }))
}
