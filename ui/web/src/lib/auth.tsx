import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CurrentUser, Product } from '@/data/types'
import * as api from '@/data/api'
import { refreshSession, setAccessToken, setUnauthenticatedHandler } from '@/lib/http'

interface AuthValue {
  user: CurrentUser | null
  products: Product[]
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  /** Mirrors the backend permission check. The server remains the real gate. */
  can: (permission: string) => boolean
  /** True when the agent may see at least some tickets somewhere. */
  canReadTickets: boolean
  /** Re-reads the product list after an admin change. */
  refreshProducts: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const hydrate = useCallback(async () => {
    const me = await api.me()
    const loaded = await api.loadReferenceData()
    setUser(me)
    setProducts(loaded)
  }, [])

  // On boot the access token is gone (it lives in memory only), so the
  // httpOnly refresh cookie mints a new one. No session simply means signed out.
  useEffect(() => {
    let cancelled = false
    setUnauthenticatedHandler(() => {
      setUser(null)
      setProducts([])
    })

    void (async () => {
      // Shares the single-flight refresh, so React's double-invoked effects in
      // development cannot fire two rotations against the same cookie.
      const restored = await refreshSession()
      if (cancelled) return
      if (!restored) {
        setLoading(false)
        return
      }
      try {
        await hydrate()
      } catch {
        setAccessToken(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      setUnauthenticatedHandler(null)
    }
  }, [hydrate])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const token = await api.login(email, password)
      setAccessToken(token)
      await hydrate()
    },
    [hydrate],
  )

  const refreshProducts = useCallback(async () => {
    setProducts(await api.listProducts())
  }, [])

  const signOut = useCallback(async () => {
    await api.logout()
    setAccessToken(null)
    setUser(null)
    setProducts([])
  }, [])

  const can = useCallback(
    (permission: string) => !!user && user.permissions.includes(permission),
    [user],
  )

  // Ticket visibility is a scope, not one permission: holding any of the three
  // is enough to open the inbox, and the server decides how much comes back.
  const canReadTickets = useMemo(
    () =>
      !!user &&
      ['ticket.view.all', 'ticket.view.team', 'ticket.view.assigned'].some((p) =>
        user.permissions.includes(p),
      ),
    [user],
  )

  const value = useMemo(
    () => ({ user, products, loading, signIn, signOut, can, canReadTickets, refreshProducts }),
    [user, products, loading, signIn, signOut, can, canReadTickets, refreshProducts],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
