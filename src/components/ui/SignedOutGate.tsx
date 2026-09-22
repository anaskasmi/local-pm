'use client'

import { LogIn } from 'lucide-react'
import { LinkButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { SignedOutPageProps } from '@/lib/rbac-args'

const DESCRIPTION =
  'This install requires an account to browse this content. Sign in and it loads as usual.'
const ORPHAN_DESCRIPTION =
  'This install requires an account to browse this content. This account has no projects assigned yet, so nothing is listed here.'

/**
 * Server-renderable gate UI for RSC pages (the my-tickets pattern): rendered
 * INSTEAD of running any scoped Local-API query when there is no usable
 * session. `orphan` swaps in the no-grants copy — message-only
 * differentiation; the action is the same sign-in link in both cases.
 */
export function SignedOutGate({ title, orphan = false, className }: SignedOutPageProps & { className?: string }) {
  return (
    <div className={className ?? 'flex h-full flex-col items-center justify-center px-6 py-16'}>
      <EmptyState
        kind="no-data"
        title={orphan ? 'No projects assigned' : title}
        description={orphan ? ORPHAN_DESCRIPTION : DESCRIPTION}
      >
        <LinkButton variant="primary" size="lg" icon={LogIn} href="/admin">
          Sign in
        </LinkButton>
      </EmptyState>
    </div>
  )
}
