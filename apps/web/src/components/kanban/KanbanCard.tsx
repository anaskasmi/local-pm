'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { MoreHorizontal, Calendar, Eye, Trash2, Ban } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { PRIORITY_COLORS, TicketPriority } from '@/types/enums'
import type { Ticket } from '@/payload-types'

interface KanbanCardProps {
  ticket: Ticket
  isOverlay?: boolean
  onClick?: () => void
  onDelete?: () => void
}

export function KanbanCard({ ticket, isOverlay, onClick, onDelete }: KanbanCardProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: ticket.id,
    data: {
      type: 'Ticket',
      ticket,
    },
    disabled: isOverlay, // Disable sorting if we are in overlay mode
  })

  // State to manage hover and menu visibility
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Determine drag state
  const isDragging = isOverlay || isSortableDragging

  // Styling for the card during drag
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1000 : 1,
  }

  // Handle menu outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu])

  // Get project info
  const project = typeof ticket.project === 'object' ? ticket.project : null
  const labels = ticket.labels || []
  const blockedCount = ticket.blockedBy?.length || 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group bg-card hover:bg-card/80 border border-border/40 hover:border-border p-3.5 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing ${isOverlay ? 'shadow-2xl ring-2 ring-primary/20 rotate-2 cursor-grabbing' : ''
        }`}
    >
      {/* Menu Trigger (Visible on hover) */}
      {!isOverlay && onDelete && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Menu Dropdown */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute top-8 right-3 z-20 w-32 bg-popover border border-border shadow-lg rounded-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(false)
              onClick?.()
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-secondary/50 text-left"
          >
            <Eye className="w-3.5 h-3.5" /> View
          </button>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(false)
                onDelete()
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-destructive hover:bg-destructive/10 text-left"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </div>
      )}

      {/* Main Card Content - Drag Handle Area */}
      {/* Activator node per dnd-kit docs (https://docs.dndkit.com/presets/sortable/usesortable#activator-node):
          attributes (role/tabIndex/aria) and listeners (keydown/pointerdown) must live on the
          SAME focusable element; setActivatorNodeRef marks it as the drag activator so keyboard
          focus lands where the activation handlers are (upstream issue anaskasmi/local-pm#3). */}
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onClick={onClick}
        className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
      >
        {/* Header: Project Badge & Priority */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {project && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border"
                style={{
                  backgroundColor: `${project.color}15`,
                  color: project.color as string,
                  borderColor: `${project.color}30`
                }}
              >
                {ticket.ticketId}
              </span>
            )}
          </div>

          {/* Priority Dot */}
          <div
            className="w-2 h-2 rounded-full ring-1 ring-background"
            style={{ backgroundColor: PRIORITY_COLORS[ticket.priority as TicketPriority] || PRIORITY_COLORS[TicketPriority.NO_PRIORITY] }}
            title={`Priority: ${ticket.priority}`}
          />
        </div>

        {/* Title */}
        <h3 className="text-sm font-medium text-foreground leading-snug line-clamp-2 pr-4">{ticket.title}</h3>

        {/* Metadata Row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {/* Labels & Date */}
          <div className="flex items-center gap-3">
            {labels.length > 0 && (
              <div className="flex -space-x-1">
                {labels.slice(0, 3).map((label, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full ring-1 ring-card"
                    style={{ backgroundColor: label.color as string }}
                    title={label.name}
                  />
                ))}
                {labels.length > 3 && (
                  <span className="text-[10px] pl-1.5 text-muted-foreground">+{labels.length - 3}</span>
                )}
              </div>
            )}

            {ticket.dueDate && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>{new Date(ticket.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
            )}
          </div>

          {/* Blocked Indicator */}
          {blockedCount > 0 && (
            <div className="flex items-center gap-1 text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
              <Ban className="w-3 h-3" />
              <span className="font-medium">{blockedCount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
