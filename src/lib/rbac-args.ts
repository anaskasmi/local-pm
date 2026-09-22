import { requireAuthEnabled } from '@/lib/access'

/**
 * Canonical page-side flag: true when the install requires authentication
 * ("auth on"). `accessOpen` was retired — it read as the opposite of what it
 * returns (it is true exactly when auth is ON).
 */
export const authRequired = requireAuthEnabled

/**
 * The ONE spread for Local-API args in RSCs. With auth on it attaches the
 * caller and forces collectionAccess to run — the Local API defaults to
 * `overrideAccess: true`, so a page that forgets this renders foreign
 * content no matter what the access rules say. With auth off it contributes
 * nothing and pages keep the pre-RBAC behaviour.
 *
 * Spread it LAST, after collection/where/depth, so it can never be clobbered:
 *   payload.find({ collection: 'tickets', where, ...scopedLocalArgs(user) })
 */
export function scopedLocalArgs<TUser extends object>(
  user: TUser | null | undefined,
): { user: TUser | undefined; overrideAccess: false } | Record<string, never> {
  if (!requireAuthEnabled()) return {}
  return { user: user ?? undefined, overrideAccess: false }
}

/**
 * Type shape for the `SignedOutGate` RSC guard (my-tickets pattern). Importing
 * the component type itself would drag client-component deps (lucide icons,
 * LinkButton) into unit tests that only need the contract; this keeps the
 * gate's props structural and test-friendly.
 */
export type SignedOutPageProps = {
  title: string
  orphan?: boolean
}
