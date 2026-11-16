import { useCallback, useEffect, useState } from 'react'
import type { ID } from '@/data/types'
import { useAuth } from '@/lib/auth'

const KEY = 'sp.product'
/** null == the combined inbox across every product the agent may access. */
export type Scope = ID | null

export function useProductScope() {
  const { user } = useAuth()
  const [scope, setScopeState] = useState<Scope>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw && raw !== 'all' ? Number(raw) : null
    } catch {
      return null
    }
  })

  // If access changed (or a stored product is no longer permitted), fall back
  // to the combined view rather than silently showing nothing.
  useEffect(() => {
    if (scope != null && user && !user.accessibleProductIds.includes(scope)) setScopeState(null)
  }, [user, scope])

  const setScope = useCallback((next: Scope) => {
    setScopeState(next)
    try {
      localStorage.setItem(KEY, next == null ? 'all' : String(next))
    } catch {
      /* non-persistent is fine */
    }
  }, [])

  return { scope, setScope }
}
