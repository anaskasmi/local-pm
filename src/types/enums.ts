export enum TicketStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum StatusType {
  TRIAGE = 'TRIAGE',
  BACKLOG = 'BACKLOG',
  UNSTARTED = 'UNSTARTED',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TicketPriority {
  NO_PRIORITY = 'NO_PRIORITY',
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const TICKET_STATUS_OPTIONS = [
  { label: 'Todo', value: TicketStatus.TODO },
  { label: 'In Progress', value: TicketStatus.IN_PROGRESS },
  { label: 'Done', value: TicketStatus.DONE },
]

export const STATUS_TYPE_OPTIONS = [
  { label: 'Triage', value: StatusType.TRIAGE },
  { label: 'Backlog', value: StatusType.BACKLOG },
  { label: 'Unstarted', value: StatusType.UNSTARTED },
  { label: 'Started', value: StatusType.STARTED },
  { label: 'Completed', value: StatusType.COMPLETED },
  { label: 'Cancelled', value: StatusType.CANCELLED },
]

export const DEFAULT_STATUSES: {
  key: string
  name: string
  type: StatusType
  order: number
  legacy: TicketStatus
}[] = [
  { key: 'todo', name: 'Todo', type: StatusType.UNSTARTED, order: 1000, legacy: TicketStatus.TODO },
  {
    key: 'in_progress',
    name: 'In Progress',
    type: StatusType.STARTED,
    order: 2000,
    legacy: TicketStatus.IN_PROGRESS,
  },
  { key: 'done', name: 'Done', type: StatusType.COMPLETED, order: 3000, legacy: TicketStatus.DONE },
]

export const LEGACY_STATUS_KEYS: Record<string, string> = {
  [TicketStatus.TODO]: 'todo',
  [TicketStatus.IN_PROGRESS]: 'in_progress',
  [TicketStatus.DONE]: 'done',
}

export const TICKET_PRIORITY_OPTIONS = [
  { label: 'No Priority', value: TicketPriority.NO_PRIORITY },
  { label: 'Urgent', value: TicketPriority.URGENT },
  { label: 'High', value: TicketPriority.HIGH },
  { label: 'Medium', value: TicketPriority.MEDIUM },
  { label: 'Low', value: TicketPriority.LOW },
]

export const PROJECT_STATUS_OPTIONS = [
  { label: 'Active', value: ProjectStatus.ACTIVE },
  { label: 'On Hold', value: ProjectStatus.ON_HOLD },
  { label: 'Completed', value: ProjectStatus.COMPLETED },
  { label: 'Cancelled', value: ProjectStatus.CANCELLED },
]

export const PROJECT_ICONS = [
  'folder',
  'rocket',
  'zap',
  'star',
  'heart',
  'flag',
  'target',
  'briefcase',
  'code',
  'box',
  'layers',
  'database',
  'megaphone',
  'cloud',
  'users',
]

export const PROJECT_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
]

export enum CycleRollover {
  NEXT = 'NEXT',
  BACKLOG = 'BACKLOG',
  NONE = 'NONE',
}

export enum CycleAutomation {
  AUTOMATIC = 'AUTOMATIC',
  MANUAL = 'MANUAL',
}

export const CYCLE_ROLLOVER_OPTIONS = [
  { label: 'Move to the next cycle', value: CycleRollover.NEXT },
  { label: 'Move back to the backlog', value: CycleRollover.BACKLOG },
  { label: 'Leave in the closed cycle', value: CycleRollover.NONE },
]

export const CYCLE_AUTOMATION_OPTIONS = [
  { label: 'Automatic', value: CycleAutomation.AUTOMATIC },
  { label: 'Manual', value: CycleAutomation.MANUAL },
]

export const CYCLE_START_DAY_OPTIONS = [
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
  { label: 'Sunday', value: 0 },
]

export const CYCLE_LENGTH_OPTIONS = [
  { label: '1 week', value: 1 },
  { label: '2 weeks', value: 2 },
  { label: '3 weeks', value: 3 },
  { label: '4 weeks', value: 4 },
  { label: '6 weeks', value: 6 },
  { label: '8 weeks', value: 8 },
]
export enum LabelColor {
  SLATE = 'SLATE',
  INDIGO = 'INDIGO',
  BLUE = 'BLUE',
  GREEN = 'GREEN',
  AMBER = 'AMBER',
  RED = 'RED',
}

export const LABEL_COLOR_OPTIONS = [
  { label: 'Slate', value: LabelColor.SLATE },
  { label: 'Indigo', value: LabelColor.INDIGO },
  { label: 'Blue', value: LabelColor.BLUE },
  { label: 'Green', value: LabelColor.GREEN },
  { label: 'Amber', value: LabelColor.AMBER },
  { label: 'Red', value: LabelColor.RED },
]

export enum EstimateScale {
  LINEAR = 'LINEAR',
  EXPONENTIAL = 'EXPONENTIAL',
  FIBONACCI = 'FIBONACCI',
  TSHIRT = 'TSHIRT',
}

export const ESTIMATE_SCALE_OPTIONS = [
  { label: 'Linear — 1, 2, 3, 4, 5', value: EstimateScale.LINEAR },
  { label: 'Fibonacci — 1, 2, 3, 5, 8, 13', value: EstimateScale.FIBONACCI },
  { label: 'Exponential — 1, 2, 4, 8, 16', value: EstimateScale.EXPONENTIAL },
  { label: 'T-shirt — XS, S, M, L, XL', value: EstimateScale.TSHIRT },
]

export const LEGACY_LABEL_COLORS: Record<string, LabelColor> = {
  '#64748b': LabelColor.SLATE,
  '#6366f1': LabelColor.INDIGO,
  '#8b5cf6': LabelColor.INDIGO,
  '#a855f7': LabelColor.INDIGO,
  '#d946ef': LabelColor.INDIGO,
  '#ec4899': LabelColor.RED,
  '#ef4444': LabelColor.RED,
  '#f97316': LabelColor.AMBER,
  '#f59e0b': LabelColor.AMBER,
  '#eab308': LabelColor.AMBER,
  '#22c55e': LabelColor.GREEN,
  '#10b981': LabelColor.GREEN,
  '#14b8a6': LabelColor.GREEN,
  '#06b6d4': LabelColor.BLUE,
  '#3b82f6': LabelColor.BLUE,
}

export enum InitiativeStatus {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const INITIATIVE_STATUS_OPTIONS = [
  { label: 'Planned', value: InitiativeStatus.PLANNED },
  { label: 'Active', value: InitiativeStatus.ACTIVE },
  { label: 'Completed', value: InitiativeStatus.COMPLETED },
  { label: 'Cancelled', value: InitiativeStatus.CANCELLED },
]

export const INITIATIVE_ICONS = [
  'target',
  'rocket',
  'flag',
  'star',
  'zap',
  'layers',
  'briefcase',
  'megaphone',
  'heart',
  'cloud',
]
