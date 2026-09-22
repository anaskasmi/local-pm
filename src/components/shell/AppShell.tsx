'use client'

import Link from 'next/link'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu as MenuIcon, Search, BookOpen } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useShortcut } from '@/lib/shortcuts'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { NAV_ITEMS, Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'
import { CommandPalette } from './CommandPalette'
import { ShortcutHelp } from './ShortcutHelp'
import { OfflineBanner } from './OfflineBanner'
import { GettingStarted } from './GettingStarted'

const COLLAPSED_KEY = 'local-pm:sidebar-collapsed'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1')
    } catch {}
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  useEffect(() => setDrawerOpen(false), [pathname])

  useShortcut({
    id: 'shell.toggleSidebar',
    keys: 'mod+backslash',
    description: 'Toggle the sidebar',
    group: 'Global',
    scope: 'global',
    allowInInput: true,
    run: toggleCollapsed,
  })

  useShortcut({
    id: 'nav.board',
    keys: 'g v',
    description: 'Go to Board',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/board'),
  })
  useShortcut({
    id: 'nav.myTickets',
    keys: 'g m',
    description: 'Go to My tickets',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/my-tickets'),
  })
  useShortcut({
    id: 'nav.triage',
    keys: 'g r',
    description: 'Go to Triage',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/triage'),
  })
  useShortcut({
    id: 'nav.cycles',
    keys: 'g c',
    description: 'Go to Cycles',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/cycles'),
  })
  useShortcut({
    id: 'nav.projects',
    keys: 'g p',
    description: 'Go to Projects',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/projects'),
  })
  useShortcut({
    id: 'nav.initiatives',
    keys: 'g n',
    description: 'Go to Initiatives',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/initiatives'),
  })
  useShortcut({
    id: 'nav.teams',
    keys: 'g t',
    description: 'Go to Teams',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/teams'),
  })
  useShortcut({
    id: 'nav.backlog',
    keys: 'g b',
    description: 'Go to Backlog (Todo column)',
    group: 'Navigate',
    scope: 'global',
    run: () => router.push('/board?status=TODO'),
  })

  useShortcut({
    id: 'shell.createTicket',
    keys: 'mod+alt+n',
    description: 'Create a ticket from anywhere',
    group: 'Global',
    scope: 'global',
    run: () => router.push('/tickets/new'),
  })

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <a href="#main" className="sr-only-focusable">
        Skip to main content
      </a>

      <OfflineBanner />

      <div className="flex min-h-0 flex-1">
        <div className="max-md:hidden">
          <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </div>

        <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim md:hidden" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 w-64 max-w-full bg-bg-subtle outline-none md:hidden"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setDrawerOpen(false)
                }
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                document.getElementById('open-navigation')?.focus()
              }}
            >
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <Sidebar
                collapsed={false}
                mobile
                onNavigate={() => setDrawerOpen(false)}
                onToggleCollapsed={() => setDrawerOpen(false)}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 flex-none items-center gap-2 border-b border-border-subtle bg-bg px-3">
            <Button
              variant="ghost"
              size="md"
              iconOnly
              icon={MenuIcon}
              id="open-navigation"
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="md:hidden"
            />

            <PaletteTrigger onClick={() => setPaletteOpen(true)} />

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                icon={BookOpen}
                onClick={() => setGuideOpen(true)}
                aria-label="Getting started"
              >
                <span className="max-sm:hidden">Getting started</span>
              </Button>
              <ThemeToggle />
            </div>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-hidden mobile-main-inset"
          >
            <ErrorBoundary region="This page">{children}</ErrorBoundary>
          </main>
        </div>
      </div>

      <MobileNav />

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutHelp />
      <GettingStarted open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  )
}

function PaletteTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 min-w-0 w-full max-w-80 items-center gap-2 rounded-sm border border-border bg-surface px-2.5',
        'text-base text-text-muted transition-colors duration-micro ease-standard',
        'hover:border-border-strong hover:bg-surface-hover',
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="truncate">Search or jump to…</span>
      <Kbd keys="mod+k" className="ml-auto max-sm:hidden" />
    </button>
  )
}

function MobileNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 mobile-nav-height flex border-t border-border-subtle bg-bg-subtle pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs',
              active ? 'font-medium text-accent-text' : 'text-text-muted',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
