'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderKanban,
  Inbox,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Repeat,
  Target,
  UserRound,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { Logo, LogoMark } from '@/components/ui/Logo'
import { Tooltip } from '@/components/ui/Tooltip'

export const SIDEBAR_DEFAULT = 256
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480
export const SIDEBAR_RAIL = 56

const WIDTH_KEY = 'local-pm:sidebar-width'

export const NAV_ITEMS = [
  { href: '/board', label: 'Board', icon: LayoutDashboard, chord: 'g v' },
  { href: '/my-tickets', label: 'My tickets', icon: UserRound, chord: 'g m' },
  { href: '/triage', label: 'Triage', icon: Inbox, chord: 'g r' },
  { href: '/cycles', label: 'Cycles', icon: Repeat, chord: 'g c' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, chord: 'g p' },
  { href: '/initiatives', label: 'Initiatives', icon: Target, chord: 'g n' },
  { href: '/teams', label: 'Teams', icon: Users, chord: 'g t' },
]

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)))
}

export function Sidebar({
  collapsed,
  mobile = false,
  onNavigate,
  onToggleCollapsed,
}: {
  collapsed: boolean
  mobile?: boolean
  onNavigate?: () => void
  onToggleCollapsed: () => void
}) {
  const pathname = usePathname()
  const [width, setWidth] = useState(SIDEBAR_DEFAULT)
  const [dragging, setDragging] = useState(false)
  const navRef = useRef<HTMLUListElement>(null)
  const [focusIndex, setFocusIndex] = useState(0)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(WIDTH_KEY)
      if (stored) setWidth(clampWidth(Number(stored)))
    } catch {}
  }, [])

  const persist = useCallback((next: number) => {
    setWidth(next)
    try {
      localStorage.setItem(WIDTH_KEY, String(next))
    } catch {}
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => setWidth(clampWidth(e.clientX))
    const onUp = () => {
      setDragging(false)
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w))
        } catch {}
        return w
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging])

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8
    if (e.key === 'ArrowLeft') persist(clampWidth(width - step))
    else if (e.key === 'ArrowRight') persist(clampWidth(width + step))
    else if (e.key === 'Home') persist(SIDEBAR_MIN)
    else if (e.key === 'End') persist(SIDEBAR_MAX)
    else return
    e.preventDefault()
  }

  const onNavKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next =
      e.key === 'ArrowDown'
        ? (focusIndex + 1) % NAV_ITEMS.length
        : (focusIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length
    setFocusIndex(next)
    navRef.current?.querySelectorAll<HTMLElement>('a')[next]?.focus()
  }

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-r border-border-subtle bg-bg-subtle"
      style={{ width: mobile ? '100%' : collapsed ? SIDEBAR_RAIL : width }}
    >
      <div
        className={cn(
          'flex h-12 flex-none items-center',
          collapsed ? 'justify-center px-2' : 'gap-2 px-3',
        )}
      >
        <Link
          href="/board"
          onClick={onNavigate}
          aria-label="local-pm, go to board"
          className="flex min-w-0 items-center rounded-sm outline-offset-4"
        >
          {collapsed ? <LogoMark className="size-7" /> : <Logo />}
        </Link>

        {!collapsed && (
          <Tooltip content={<span>Collapse sidebar</span>}>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={PanelLeftClose}
              aria-label={mobile ? 'Close navigation' : 'Collapse sidebar'}
              onClick={onToggleCollapsed}
              className="ml-auto"
            />
          </Tooltip>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center pb-1 pt-1">
          <Tooltip content="Expand sidebar" side="right">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={PanelLeftOpen}
              aria-label="Expand sidebar"
              onClick={onToggleCollapsed}
            />
          </Tooltip>
        </div>
      )}

      <div className={cn('flex-none pb-2', collapsed ? 'px-2' : 'px-3')}>
        {collapsed ? (
          <Tooltip content="New ticket" side="right">
            <Link
              href="/tickets/new"
              onClick={onNavigate}
              aria-label="New ticket"
              title="New ticket (Ctrl/⌘ + Alt + N)"
              className={cn(
                'flex size-9 items-center justify-center rounded-sm border border-border bg-surface text-text',
                'transition-colors duration-micro ease-standard hover:bg-surface-hover',
              )}
            >
              <Plus className="size-5" aria-hidden />
            </Link>
          </Tooltip>
        ) : (
          <Link
            href="/tickets/new"
            onClick={onNavigate}
            className={cn(
              'flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-base font-medium text-text',
              'transition-colors duration-micro ease-standard hover:bg-surface-hover',
            )}
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            New ticket
          </Link>
        )}
      </div>

      <nav
        aria-label="Main"
        className={cn('min-h-0 flex-1 overflow-y-auto', collapsed ? 'px-2' : 'px-3')}
      >
        {!collapsed && (
          <h2 className="px-2.5 pb-1.5 pt-1 text-2xs font-medium uppercase tracking-[0.06em] text-text-muted">
            Workspace
          </h2>
        )}

        <ul ref={navRef} className="flex flex-col gap-0.5" onKeyDown={onNavKeyDown}>
          {NAV_ITEMS.map((item, index) => {
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`)
            const Icon = item.icon
            const link = (
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                onFocus={() => setFocusIndex(index)}
                className={cn(
                  'group relative flex h-9 items-center rounded-sm text-base',
                  'transition-colors duration-micro ease-standard',
                  collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                  active
                    ? 'bg-accent-subtle font-medium text-accent-text'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text',

                  active &&
                    'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent before:content-[""]',
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && (
                  <Kbd
                    keys={item.chord}
                    className={cn(
                      'ml-auto transition-opacity duration-fast',
                      'can-hover:opacity-0 can-hover:group-hover:opacity-100 can-hover:group-focus-within:opacity-100',
                      active && 'can-hover:opacity-100',
                    )}
                  />
                )}
              </Link>
            )

            return (
              <li key={item.href}>
                {collapsed ? (
                  <Tooltip content={item.label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <div
        className={cn('flex-none border-t border-border-subtle py-2', collapsed ? 'px-2' : 'px-3')}
      >
        {collapsed ? (
          <Tooltip content="Keyboard shortcuts" side="right">
            <button
              type="button"
              aria-label="Keyboard shortcuts"
              onClick={() => window.dispatchEvent(new CustomEvent('local-pm:open-shortcuts'))}
              className="flex h-8 w-full items-center justify-center rounded-sm text-text-muted transition-colors duration-micro hover:bg-surface-hover hover:text-text"
            >
              <Kbd raw="?" />
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('local-pm:open-shortcuts'))}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-xs',
              'text-text-muted transition-colors duration-micro hover:bg-surface-hover hover:text-text',
            )}
          >
            Keyboard shortcuts
            <Kbd raw="?" className="ml-auto" />
          </button>
        )}
      </div>

      {!collapsed && !mobile && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDoubleClick={() => persist(SIDEBAR_DEFAULT)}
          onKeyDown={onHandleKeyDown}
          className={cn(
            'absolute right-0 top-0 h-full w-1 cursor-col-resize',
            'transition-colors duration-micro hover:bg-accent',
            dragging && 'bg-accent',
          )}
        />
      )}
    </div>
  )
}
