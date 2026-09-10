import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DndContext, type DragStartEvent, type DragCancelEvent, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { KanbanCard } from '@/components/kanban/KanbanCard'
import type { Ticket } from '@/payload-types'

/**
 * W16 — Keyboard drag accessibility fix (upstream issue anaskasmi/local-pm#3).
 *
 * Root cause: `attributes` (role="button" + tabIndex={0} emitted by
 * useSortable) were attached to the card ROOT (setNodeRef) while `listeners`
 * (keydown/pointerdown activation) stayed on the inner content div, and
 * setActivatorNodeRef was never used anywhere. Focus landed on the root while
 * the activation listener lived on a non-focusable child → keyboard drag
 * could never activate.
 *
 * Fix under test — the documented dnd-kit "Activator node" pattern
 * (https://docs.dndkit.com/presets/sortable/usesortable#activator-node):
 * attributes + listeners + setActivatorNodeRef all live on the SAME handle
 * element; the root keeps only setNodeRef + transform/transition styling.
 *
 * Real @dnd-kit/core + @dnd-kit/sortable run in jsdom (no mocks): the
 * keydown→drag-start contract is dnd-kit's, the wiring is ours, and the
 * harness asserts on our wiring via DndContext callbacks.
 */

const onDragStart = vi.fn()
const onDragCancel = vi.fn()
const onDragEnd = vi.fn()
const openDetail = vi.fn()

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tick_1',
    ticketId: 'PCF-1',
    title: 'Keyboard-draggable card',
    status: 'TODO',
    priority: 'MEDIUM',
    project: 'proj_1',
    labels: [],
    blockedBy: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as Ticket
}

function Harness({ ticket }: { ticket: Ticket }) {
  return (
    <DndContext
      onDragStart={(event: DragStartEvent) => onDragStart(event.active.id)}
      onDragCancel={(event: DragCancelEvent) => onDragCancel(event.active.id)}
      onDragEnd={(event: DragEndEvent) => onDragEnd(event.active.id)}
    >
      <SortableContext items={[ticket.id]}>
        <KanbanCard ticket={ticket} onClick={openDetail} />
      </SortableContext>
    </DndContext>
  )
}

/**
 * The draggable root is the card container (bg-card, not a button role).
 * The handle is the new focusable activator: role="button", tabIndex 0.
 */
function getRoot(handle: HTMLElement): HTMLElement {
  let node: HTMLElement | null = handle.parentElement
  while (node && !node.classList.contains('bg-card')) {
    node = node.parentElement
  }
  expect(node).not.toBeNull()
  return node as HTMLElement
}

function focusAndPressSpace(): void {
  const handle = screen.getByRole('button', { name: /Keyboard-draggable card/ })
  handle.focus()
  expect(handle).toHaveFocus()
  // dnd-kit's KeyboardSensor activator reads nativeEvent.code — fireEvent
  // does NOT derive `code` from `key`, so it must be passed explicitly.
  fireEvent.keyDown(handle, { key: ' ', code: 'Space' })
}

beforeEach(() => {
  onDragStart.mockReset()
  onDragCancel.mockReset()
  onDragEnd.mockReset()
  openDetail.mockReset()
})

describe('W16: KanbanCard keyboard drag accessibility (issue #3)', () => {
  it('(1) handle carries the sortable attributes; root carries none of them', () => {
    render(<Harness ticket={makeTicket()} />)

    const handle = screen.getByRole('button', { name: /Keyboard-draggable card/ })
    expect(handle.getAttribute('role')).toBe('button')
    expect(handle.getAttribute('tabindex')).toBe('0')
    expect(handle.getAttribute('aria-roledescription')).toBe('sortable')
    expect(handle.getAttribute('aria-describedby')).toBeTruthy()

    const root = getRoot(handle)
    expect(root.getAttribute('role')).toBeNull()
    expect(root.getAttribute('tabindex')).toBeNull()
    expect(root.getAttribute('aria-roledescription')).toBeNull()
    expect(root.getAttribute('aria-describedby')).toBeNull()
  })

  it('(2) Space on the focused handle starts a drag (onDragStart fires with the ticket id)', () => {
    render(<Harness ticket={makeTicket()} />)

    focusAndPressSpace()

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onDragStart).toHaveBeenCalledWith('tick_1')
  })

  it('(3) Escape cancels the in-flight keyboard drag (onDragCancel fires, no drag end)', async () => {
    render(<Harness ticket={makeTicket()} />)

    focusAndPressSpace()
    expect(onDragStart).toHaveBeenCalledTimes(1)

    const handle = screen.getByRole('button', { name: /Keyboard-draggable card/ })
    // dnd-kit's KeyboardSensor attaches its in-drag keydown listener on the
    // owner DOCUMENT via setTimeout(…, 0) (KeyboardSensor.attach) — flush the
    // macrotask, then dispatch on document. Cancel code is KeyboardCode.Esc,
    // whose string value is 'Escape' in @dnd-kit/core 6.x.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // jsdom fires the document-level listener twice for one dispatched event
    // (sensor listener + React-delegated activator path), so we assert the
    // CONTRACT — cancel happened with the ticket id, no drag-end, no open —
    // rather than an exact call count that would pin a test-env artifact.
    expect(onDragCancel).toHaveBeenCalled()
    expect(onDragCancel).toHaveBeenCalledWith('tick_1')
    expect(onDragEnd).not.toHaveBeenCalled()
    expect(openDetail).not.toHaveBeenCalled()
  })

  it('(4) plain click on the handle still opens the detail (onClick preserved)', () => {
    render(<Harness ticket={makeTicket()} />)

    fireEvent.click(screen.getByRole('button', { name: /Keyboard-draggable card/ }))

    expect(openDetail).toHaveBeenCalledTimes(1)
    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('handle exposes the focus-visible ring for visible keyboard focus', () => {
    render(<Harness ticket={makeTicket()} />)

    const handle = screen.getByRole('button', { name: /Keyboard-draggable card/ })
    expect(handle.className).toContain('focus-visible:ring-2')
    expect(handle.className).toContain('focus-visible:ring-primary/40')
  })
})
