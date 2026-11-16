import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useAuth } from '@/lib/auth'
import { useProductScope } from '@/hooks/useProductScope'
import * as api from '@/data/api'
import type { Product, Ticket } from '@/data/types'
import { cn } from '@/lib/cn'
import { NewTicketModal } from '@/components/NewTicketModal'

export interface ShellContext {
  products: Product[]
  scope: number | null
  setScope: (s: number | null) => void
  tickets: Ticket[]
  reload: () => void
  /** Opens the shared "new ticket" dialog from anywhere in the app. */
  newTicket: () => void
  /** Set when the ticket load failed, so panes can say so instead of
   *  rendering an empty list that looks like "no tickets". */
  loadError: string | null
  loading: boolean
}

export function AppShell() {
  const { user, products } = useAuth()
  const { scope, setScope } = useProductScope()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [drawer, setDrawer] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [composing, setComposing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingTickets, setLoadingTickets] = useState(true)
  const location = useLocation()
  const [params, setParams] = useSearchParams()

  // One list for the whole shell; panes filter it client-side. The server has
  // already scoped it to what this agent may see.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadingTickets(true)
    api
      // 100 is the API's page cap. Asking for more is a 422, which used to be
      // swallowed into an empty list that looked exactly like "no tickets".
      .listTickets({ perPage: 100 })
      .then((res) => {
        if (cancelled) return
        setTickets(res.tickets)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTickets([])
        setLoadError(err instanceof Error ? err.message : 'Could not load tickets')
      })
      .finally(() => !cancelled && setLoadingTickets(false))
    return () => {
      cancelled = true
    }
  }, [user, nonce])

  useEffect(() => setDrawer(false), [location.pathname])

  // ?new=1 deep-links straight to the compose dialog, so "raise a ticket" can
  // be bookmarked or linked from another tool.
  useEffect(() => {
    if (params.get('new') === '1') setComposing(true)
  }, [params])

  const closeCompose = () => {
    setComposing(false)
    if (params.get('new')) {
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }

  const inScope = useMemo(
    () => (scope == null ? tickets : tickets.filter((t) => t.productId === scope)),
    [tickets, scope],
  )

  const counts = useMemo(() => {
    const open = inScope.filter((t) => api.statusByCode(t.statusCode).isOpen)
    return { inbox: open.length, unassigned: open.filter((t) => t.assigneeId == null).length }
  }, [inScope])

  const reload = () => setNonce((n) => n + 1)
  const ctx: ShellContext = {
    products, scope, setScope, tickets: inScope, reload,
    newTicket: () => setComposing(true),
    loadError, loading: loadingTickets,
  }

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      {/* Desktop navigation */}
      <div className="hidden lg:block">
        <Sidebar products={products} scope={scope} onScopeChange={setScope} counts={counts} />
      </div>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-50 lg:hidden', drawer ? 'block' : 'hidden')}>
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setDrawer(false)} />
        <div className="absolute inset-y-0 left-0 animate-slide-down">
          <Sidebar
            products={products}
            scope={scope}
            onScopeChange={setScope}
            counts={counts}
            onNavigate={() => setDrawer(false)}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar products={products} onOpenSidebar={() => setDrawer(true)} onNewTicket={() => setComposing(true)} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet context={ctx} />
        </main>
      </div>

      <NewTicketModal
        open={composing}
        onClose={closeCompose}
        products={products}
        onCreated={reload}
      />
    </div>
  )
}
