'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Diamond,
  FileText,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Pencil,
  Repeat,
  Trash2,
} from 'lucide-react'
import { initiativeStatusMeta } from '@/lib/status'
import { EntityMark, initiativeIcon } from '@/components/ui/EntityMark'
import { cn } from '@/lib/cn'
import { ProjectStatus, TicketStatus } from '@/types/enums'
import { projectStatusOptions } from '@/lib/status'
import { formatDateTimeRelative } from '@/lib/format'
import { durationInDays } from '@/lib/dates'
import { useOptimisticPatch, saveStateLabel } from '@/hooks/useOptimisticPatch'
import { Button, LinkButton } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Expandable } from '@/components/ui/Expandable'
import { DatePicker } from '@/components/ui/DatePicker'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { projectIcon } from '@/components/ui/EntityMark'
import { InlineEdit } from '@/components/ui/InlineEdit'
import { StatusTypeBadge } from '@/components/ui/StateIndicator'
import { StatusType } from '@/types/enums'
import { TabList, TabPanel } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { RichTextDisplay } from '@/components/ui/RichTextEditor'
import { TicketsTable } from '@/components/tickets/TicketsTable'
import { CycleSettings } from '@/components/cycles/CycleSettings'
import { EstimateSettings } from '@/components/projects/EstimateSettings'
import { TriageSettings } from '@/components/projects/TriageSettings'
import type { Initiative, Project } from '@/payload-types'

export interface ProjectStats {
  total: number
  todo: number
  inProgress: number
  done: number
}

const TAB_IDS = ['overview', 'tickets', 'cycles', 'estimates', 'triage'] as const
type TabId = (typeof TAB_IDS)[number]

export function ProjectDetail({
  project: initialProject,
  stats,
  initiatives = [],
  initialTab = 'overview',
}: {
  project: Project
  stats: ProjectStats
  initiatives?: Initiative[]
  initialTab?: TabId
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [project, setProject] = useState(initialProject)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const apply = useCallback((next: Project) => setProject(next), [])
  const { patch, state } = useOptimisticPatch<Project>({
    collection: 'projects',
    record: project,
    onApply: apply,
  })

  const description = (project.description as unknown as string) || ''
  const savingLabel = saveStateLabel(state)
  const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0
  const span = durationInDays(project.startDate, project.targetDate)

  const selectTab = (next: string) => {
    setTab(next as TabId)
    const url = next === 'overview' ? window.location.pathname : `?tab=${next}`
    window.history.pushState(null, '', url)
  }

  useEffect(() => {
    const onPopState = () => {
      const next = new URLSearchParams(window.location.search).get('tab')
      setTab(TAB_IDS.includes(next as TabId) ? (next as TabId) : 'overview')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const deleteProject = async () => {
    setDeleting(true)
    try {
      const ticketsResponse = await fetch(
        `/api/tickets?where[project][equals]=${project.id}&limit=1000&depth=0`,
      )
      const ticketsData = await ticketsResponse.json()
      await Promise.all(
        ((ticketsData.docs ?? []) as { id: string }[]).map((t) =>
          fetch(`/api/tickets/${t.id}`, { method: 'DELETE' }),
        ),
      )

      const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      toast({ title: `${project.name} deleted`, tone: 'info' })
      router.push('/projects')
      router.refresh()
    } catch (error) {
      toast({
        tone: 'error',
        title: "Couldn't delete that project",
        description: error instanceof Error ? error.message : undefined,
      })
      setDeleting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-none flex-col gap-3 border-b border-border-subtle px-6 pt-4 max-md:px-4">
        <nav aria-label="Breadcrumb">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs text-text-muted transition-colors duration-micro hover:text-text"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Projects
          </Link>
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <EntityMark icon={projectIcon(project.icon)} color={project.color} size="lg" />

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-text">
              <InlineEdit
                label="Project name"
                value={project.name}
                validate={(next) => (next ? null : 'A name is required.')}
                onCommit={(next) => patch({ name: next }, 'the name')}
              />
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span className="tabular">{project.prefix}</span>
              <span aria-hidden>·</span>
              <span className="tabular">
                {stats.total} {stats.total === 1 ? 'ticket' : 'tickets'}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular">{percent}% complete</span>
              {savingLabel && (
                <>
                  <span aria-hidden>·</span>
                  <span
                    aria-live="polite"
                    className={state === 'error' ? 'text-danger-text' : undefined}
                  >
                    {savingLabel}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <LinkButton variant="secondary" icon={Pencil} href={`/projects/${project.id}/edit`}>
              Edit
            </LinkButton>
            <LinkButton
              variant="secondary"
              icon={LayoutDashboard}
              href={`/board?project=${project.id}`}
            >
              Board
            </LinkButton>
            <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </div>

        <TabList
          label="Project sections"
          idPrefix="project"
          value={tab}
          onChange={selectTab}
          tabs={[
            { id: 'overview', label: 'Overview', icon: FileText },
            { id: 'tickets', label: 'Tickets', icon: ListChecks, count: stats.total },
            { id: 'cycles', label: 'Cycles', icon: Repeat },
            { id: 'estimates', label: 'Estimates', icon: Diamond },
            { id: 'triage', label: 'Triage', icon: Inbox },
          ]}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 max-md:px-4">
        <TabPanel id="overview" idPrefix="project" active={tab === 'overview'}>
          <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-8 max-lg:grid-cols-1">
            <section className="flex min-w-0 flex-col gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Description
              </h2>
              <Expandable lines={10}>
                <RichTextDisplay content={description} wide />
              </Expandable>
            </section>

            <aside className="flex flex-col gap-6">
              <Field label="Status">
                {({ id }) => (
                  <Select
                    id={id}
                    value={project.status}
                    options={projectStatusOptions()}
                    onValueChange={(next) => patch({ status: next as ProjectStatus }, 'the status')}
                  />
                )}
              </Field>

              <section className="flex flex-col gap-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Dates
                </h2>

                <Field label="Start date" optional>
                  {({ id }) => (
                    <DatePicker
                      id={id}
                      label="Start date"
                      value={project.startDate ? project.startDate.slice(0, 10) : ''}
                      onChange={(next) => patch({ startDate: next || null }, 'the start date')}
                    />
                  )}
                </Field>

                <Field label="Target date" optional>
                  {({ id }) => (
                    <DatePicker
                      id={id}
                      label="Target date"
                      value={project.targetDate ? project.targetDate.slice(0, 10) : ''}
                      onChange={(next) => patch({ targetDate: next || null }, 'the target date')}
                    />
                  )}
                </Field>

                {span !== null && (
                  <p className="text-xs text-text-muted tabular">
                    {span} {span === 1 ? 'day' : 'days'} planned
                  </p>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Progress
                </h2>

                <div>
                  <div
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Tickets complete"
                    className="h-2 overflow-hidden rounded-full bg-surface-hover"
                  >
                    <div
                      className="h-full rounded-full bg-success transition-[width] duration-standard ease-standard"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-text-muted tabular">
                    {percent}% complete · {stats.done} of {stats.total} done
                  </p>
                </div>

                <dl className="flex flex-col">
                  {(
                    [
                      ['Todo', stats.todo, StatusType.UNSTARTED],
                      ['In progress', stats.inProgress, StatusType.STARTED],
                      ['Done', stats.done, StatusType.COMPLETED],
                    ] as const
                  ).map(([label, value, type]) => (
                    <div
                      key={label}
                      className="flex h-9 items-center justify-between gap-2 border-b border-border-subtle last:border-b-0"
                    >
                      <dt className="flex items-center gap-2 text-base text-text-muted">
                        <StatusTypeBadge type={type} label={label} />
                      </dt>
                      <dd className={cn('text-base text-text tabular')}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {initiatives.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Initiatives
                  </h2>
                  <ul className="flex flex-col gap-1">
                    {initiatives.map((initiative) => {
                      const meta = initiativeStatusMeta(initiative.status)
                      const StatusIcon = meta.icon
                      return (
                        <li key={initiative.id}>
                          <Link
                            href={`/initiatives/${initiative.id}`}
                            className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1 text-base text-text transition-colors duration-micro hover:bg-surface-hover"
                          >
                            <EntityMark
                              icon={initiativeIcon(initiative.icon)}
                              color={initiative.color}
                              size="sm"
                            />
                            <span className="min-w-0 truncate" title={initiative.name}>
                              {initiative.name}
                            </span>
                            <StatusIcon
                              className="ml-auto size-4 shrink-0 text-text-muted"
                              aria-hidden
                            />
                            <span className="sr-only">{meta.label}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              <dl className="flex flex-col gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
                <div className="flex justify-between gap-2">
                  <dt>Created</dt>
                  <dd className="text-text tabular">{formatDateTimeRelative(project.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Updated</dt>
                  <dd className="text-text tabular">{formatDateTimeRelative(project.updatedAt)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </TabPanel>

        <TabPanel id="tickets" idPrefix="project" active={tab === 'tickets'}>
          <TicketsTable
            where={{ project: project.id }}
            caption={`Tickets in ${project.name}`}
            keyColor={project.color}
            relationColumn="team"
            newTicketHref={`/tickets/new?project=${project.id}&returnTo=${encodeURIComponent(
              `/projects/${project.id}?tab=tickets`,
            )}`}
            emptyTitle="No tickets in this project"
            emptyDescription="Tickets created here get the key prefix and show up on the board."
          />
        </TabPanel>

        <TabPanel id="cycles" idPrefix="project" active={tab === 'cycles'}>
          <CycleSettings project={project} />
        </TabPanel>

        <TabPanel id="estimates" idPrefix="project" active={tab === 'estimates'}>
          <EstimateSettings project={project} />
        </TabPanel>

        <TabPanel id="triage" idPrefix="project" active={tab === 'triage'}>
          <TriageSettings project={project} />
        </TabPanel>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteProject}
        loading={deleting}
        title="Delete this project?"
        message={`“${project.name}” (${project.prefix})`}
        consequence={
          stats.total > 0
            ? `Permanently deletes ${stats.total} ticket${stats.total === 1 ? '' : 's'} and their history. This cannot be undone.`
            : 'This project has no tickets. This cannot be undone.'
        }
        confirmPhrase={stats.total > 0 ? project.name : undefined}
        confirmLabel="Delete project"
      />
    </div>
  )
}
