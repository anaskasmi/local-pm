'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useOptimisticPatch, saveStateLabel } from '@/hooks/useOptimisticPatch'
import type { Project } from '@/payload-types'

export function TriageSettings({ project: initialProject }: { project: Project }) {
  const [project, setProject] = useState(initialProject)

  const apply = useCallback((next: Project) => setProject(next), [])
  const { patch, state } = useOptimisticPatch<Project>({
    collection: 'projects',
    record: project,
    onApply: apply,
  })

  const enabled = Boolean(project.triage?.enabled)
  const savingLabel = saveStateLabel(state)

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              patch({ triage: { enabled: event.target.checked } }, 'the triage setting')
            }
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span className="flex flex-col gap-1">
            <span className="text-base font-medium text-text">Triage incoming work</span>
            <span className="text-sm text-text-muted">
              New work waits in a queue until someone accepts, declines or merges it. Items in triage
              stay out of the board and the ticket list until they are accepted.
            </span>
          </span>
        </label>

        {savingLabel && (
          <p
            aria-live="polite"
            className={state === 'error' ? 'text-xs text-danger-text' : 'text-xs text-text-muted'}
          >
            {savingLabel}
          </p>
        )}
      </div>

      {enabled && (
        <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-subtle p-4">
          <p className="text-sm text-text-muted">
            A <span className="font-medium text-text">Triage</span> status has been added to this
            project&rsquo;s workflow. File work into it from the ticket form, the API, or an agent
            over MCP, and resolve it from the queue.
          </p>
          <Link
            href={`/triage?project=${project.id}`}
            className="self-start rounded-sm text-sm font-medium text-accent-text underline-offset-2 hover:underline"
          >
            Open the triage queue
          </Link>
        </div>
      )}
    </div>
  )
}
