import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Check, ChevronDown, Filter, Flame, Inbox as InboxIcon, Maximize2, Minimize2,
  PanelLeftClose, PanelLeftOpen, Plus, Receipt, UserX, X, Zap,
} from 'lucide-react'
import type { ShellContext } from '@/components/layout/AppShell'
import type { Ticket } from '@/data/types'
import * as api from '@/data/api'
import { useAuth } from '@/lib/auth'
import { Avatar } from '@/components/ui/Avatar'
import { PriorityBadge, StatusBadge, TagChip } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { relativeTime, excerpt } from '@/lib/format'
import { scrollTo } from '@/lib/scroll'
import { cn } from '@/lib/cn'

const VIEW_ICONS: Record<string, React.ReactNode> = {
  zap: <Zap className="h-3.5 w-3.5" />,
  flame: <Flame className="h-3.5 w-3.5" />,
  receipt: <Receipt className="h-3.5 w-3.5" />,
}

const RAIL_KEY = 'sp.inbox.rail'
const LIST_KEY = 'sp.inbox.list'
const SECTIONS_KEY = 'sp.inbox.sections'

type Sections = { saved: boolean; status: boolean; priority: boolean }
const DEFAULT_SECTIONS: Sections = { saved: true, status: true, priority: true }

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

export function Inbox() {
  const ctx = useOutletContext<ShellContext>()
  const { user, can } = useAuth()
  const { ticketId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const listRef = useRef<HTMLDivElement>(null)

  const q = params.get('q') ?? ''
  const view = params.get('view') ?? ''
  const status = params.getAll('status')
  const priority = params.getAll('priority')
  const assignee = params.get('assignee') ?? ''

  // Rail and section state persist per browser: an agent who works collapsed
  // should not have to re-collapse it every morning.
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const [listOpen, setListOpen] = useState(() => {
    try {
      return localStorage.getItem(LIST_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const [sections, setSections] = useState<Sections>(() => readJSON(SECTIONS_KEY, DEFAULT_SECTIONS))

  // Collapsing the list is only meaningful while a ticket is open — with
  // nothing selected it would leave an empty screen and nothing to click. So
  // the list always returns when the agent closes the ticket.
  const showList = listOpen || !ticketId

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railOpen ? 'open' : 'closed')
    } catch { /* non-persistent is fine */ }
  }, [railOpen])

  useEffect(() => {
    try {
      localStorage.setItem(LIST_KEY, listOpen ? 'open' : 'closed')
    } catch { /* non-persistent is fine */ }
  }, [listOpen])

  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
    } catch { /* non-persistent is fine */ }
  }, [sections])

  const toggleSection = useCallback(
    (key: keyof Sections) => setSections((s) => ({ ...s, [key]: !s[key] })),
    [],
  )

  const counts = useMemo(() => {
    const open = ctx.tickets.filter((t) => api.statusByCode(t.statusCode).isOpen)
    return {
      all: ctx.tickets.length,
      open: open.length,
      mine: ctx.tickets.filter((t) => t.assigneeId === user?.id).length,
      unassigned: open.filter((t) => t.assigneeId == null).length,
      overdue: ctx.tickets.filter(api.isOverdue).length,
    }
  }, [ctx.tickets, user?.id])

  const VIEWS = [
    { key: '', label: 'All tickets', icon: <InboxIcon className="h-3.5 w-3.5" />, count: counts.all },
    { key: 'open', label: 'Open', icon: <Zap className="h-3.5 w-3.5" />, count: counts.open },
    { key: 'mine', label: 'My tickets', icon: <Check className="h-3.5 w-3.5" />, count: counts.mine },
    { key: 'unassigned', label: 'Unassigned', icon: <UserX className="h-3.5 w-3.5" />, count: counts.unassigned },
    { key: 'overdue', label: 'Overdue', icon: <Flame className="h-3.5 w-3.5" />, count: counts.overdue },
  ]

  const filtered = useMemo(() => {
    let rows = ctx.tickets
    if (view === 'unassigned') rows = rows.filter((t) => t.assigneeId == null && api.statusByCode(t.statusCode).isOpen)
    if (view === 'mine') rows = rows.filter((t) => t.assigneeId === user?.id)
    if (view === 'overdue') rows = rows.filter(api.isOverdue)
    if (view === 'open') rows = rows.filter((t) => api.statusByCode(t.statusCode).isOpen)
    if (status.length) rows = rows.filter((t) => status.includes(t.statusCode))
    if (priority.length) rows = rows.filter((t) => priority.includes(t.priorityCode))
    if (assignee === 'me') rows = rows.filter((t) => t.assigneeId === user?.id)
    else if (assignee === 'none') rows = rows.filter((t) => t.assigneeId == null)
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      rows = rows.filter((t) => {
        const c = api.customerById(t.customerId)
        return (
          t.subject.toLowerCase().includes(s) ||
          t.number.toLowerCase().includes(s) ||
          c.name.toLowerCase().includes(s) ||
          c.emails.some((e) => e.toLowerCase().includes(s)) ||
          t.messages.some((m) => excerpt(m.bodyHtml, 10_000).toLowerCase().includes(s))
        )
      })
    }
    return rows
  }, [ctx.tickets, view, status.join(), priority.join(), assignee, q, user?.id])

  useEffect(() => {
    scrollTo(listRef.current, 0)
  }, [view, status.join(), priority.join(), assignee, q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (e.key === '[') {
        e.preventDefault()
        setRailOpen((v) => !v)
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        if (ticketId) setListOpen((v) => !v)
        return
      }
      if (e.key !== 'j' && e.key !== 'k') return
      e.preventDefault()
      const idx = filtered.findIndex((t) => String(t.id) === ticketId)
      const next = e.key === 'j' ? Math.min(idx + 1, filtered.length - 1) : Math.max(idx - 1, 0)
      const target = filtered[idx === -1 ? 0 : next]
      if (target) navigate(`/inbox/${target.id}${window.location.search}`)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filtered, ticketId, navigate])

  const toggle = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    const current = next.getAll(key)
    next.delete(key)
    const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    updated.forEach((v) => next.append(key, v))
    setParams(next, { replace: true })
  }

  const setView = (v: string) => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (v) next.set('view', v)
    // Column filters are kept — a view and a filter are different questions and
    // switching tabs should not silently discard a narrowing the agent set.
    status.forEach((s) => next.append('status', s))
    priority.forEach((p) => next.append('priority', p))
    if (assignee) next.set('assignee', assignee)
    setParams(next, { replace: true })
  }

  const activeFilters = status.length + priority.length + (assignee ? 1 : 0)
  const clearFilters = () => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (view) next.set('view', view)
    setParams(next, { replace: true })
  }
  const clearAll = () => setParams(new URLSearchParams(), { replace: true })

  return (
    <div className="flex h-full flex-col">
      {/* ─── View tabs ─────────────────────────────────────────────────────── */}
      <div className="flex h-11 shrink-0 items-stretch gap-1 border-b border-line bg-surface px-2">
        <button
          onClick={() => setRailOpen((v) => !v)}
          title={railOpen ? 'Hide filters  ([)' : 'Show filters  ([)'}
          aria-label={railOpen ? 'Hide filters' : 'Show filters'}
          aria-expanded={railOpen}
          className={cn(
            'my-1.5 hidden shrink-0 items-center gap-1.5 rounded-ctl px-2 text-xs font-medium transition-colors xl:inline-flex',
            activeFilters > 0
              ? 'bg-brand-soft text-brand'
              : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
          )}
        >
          {railOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          {activeFilters > 0 && <span className="tabular-nums">{activeFilters}</span>}
        </button>

        {ticketId && (
          <button
            onClick={() => setListOpen((v) => !v)}
            title={listOpen ? 'Hide list — full-width conversation  (])' : 'Show ticket list  (])'}
            aria-label={listOpen ? 'Hide ticket list' : 'Show ticket list'}
            aria-expanded={listOpen}
            className="my-1.5 hidden shrink-0 items-center rounded-ctl px-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink md:inline-flex"
          >
            {listOpen ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </button>
        )}

        <div className="my-2 hidden w-px shrink-0 bg-line xl:block" />

        <nav className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto" aria-label="Ticket views">
          {VIEWS.map((v) => {
            const active = view === v.key
            return (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[13px] font-medium transition-colors',
                  active ? 'text-brand' : 'text-ink-muted hover:text-ink',
                )}
              >
                <span className={cn('shrink-0', active ? 'text-brand' : 'text-ink-subtle')}>{v.icon}</span>
                {v.label}
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                    active ? 'bg-brand-soft text-brand' : 'bg-surface-3 text-ink-muted',
                  )}
                >
                  {v.count}
                </span>
                {/* Underline marks the active tab, so identity is not colour alone. */}
                {active && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-brand" />}
              </button>
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 pl-2">
          {q && (
            <span className="hidden max-w-[180px] items-center gap-1 truncate text-xs text-ink-subtle sm:flex">
              <Filter className="h-3 w-3 shrink-0" />
              <span className="truncate">“{q}”</span>
              <button onClick={clearAll} aria-label="Clear search"><X className="h-3 w-3" /></button>
            </span>
          )}
          {can('ticket.create') && (
            <Button size="xs" variant="primary" onClick={ctx.newTicket} className="my-1.5">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ─── Collapsible filter rail ─────────────────────────────────────── */}
        {railOpen && (
          <div className="hidden w-[196px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-2 p-3 xl:flex">
            <Section title="Saved views" open={sections.saved} onToggle={() => toggleSection('saved')}>
              {api.savedViews.map((sv) => (
                <button
                  key={sv.id}
                  onClick={() => {
                    const next = new URLSearchParams()
                    sv.filters.statusCodes?.forEach((s) => next.append('status', s))
                    sv.filters.priorityCodes?.forEach((p) => next.append('priority', p))
                    if (sv.filters.assigneeId === 'unassigned') next.set('assignee', 'none')
                    setParams(next, { replace: true })
                  }}
                  className="flex w-full items-center gap-2 rounded-ctl px-2 py-[6px] text-left text-[13px] text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <span className="shrink-0">{VIEW_ICONS[sv.icon]}</span>
                  <span className="min-w-0 flex-1 truncate">{sv.name}</span>
                  {sv.isShared && <span className="shrink-0 text-2xs text-ink-subtle">shared</span>}
                </button>
              ))}
            </Section>

            <Section
              title="Status"
              count={status.length}
              open={sections.status}
              onToggle={() => toggleSection('status')}
            >
              {api.statuses.map((s) => (
                <label key={s.code} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-surface-3">
                  <input type="checkbox" checked={status.includes(s.code)} onChange={() => toggle('status', s.code)}
                         className="h-3.5 w-3.5 accent-[rgb(var(--brand))]" />
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="min-w-0 truncate text-ink-muted">{s.name}</span>
                </label>
              ))}
            </Section>

            <Section
              title="Priority"
              count={priority.length}
              open={sections.priority}
              onToggle={() => toggleSection('priority')}
            >
              {api.priorities.map((p) => (
                <label key={p.code} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-surface-3">
                  <input type="checkbox" checked={priority.includes(p.code)} onChange={() => toggle('priority', p.code)}
                         className="h-3.5 w-3.5 accent-[rgb(var(--brand))]" />
                  <span className="min-w-0 truncate text-ink-muted">{p.name}</span>
                </label>
              ))}
            </Section>

            {activeFilters > 0 && (
              <Button size="xs" variant="ghost" className="mt-3 justify-start" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" /> Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        )}

        {/* ─── Ticket list ─────────────────────────────────────────────────── */}
        <div
          className={cn(
            'flex w-full shrink-0 flex-col border-r border-line bg-surface md:w-[372px]',
            ticketId && 'hidden md:flex',
            // twMerge keeps the last display utility, so this wins when collapsed.
            !showList && 'hidden md:hidden',
          )}
        >
          <div ref={listRef} className="scroll-smooth-area min-h-0 flex-1 overflow-y-auto">
            {ctx.loadError ? (
              // A failed load must not look like an empty queue.
              <EmptyState
                icon={<AlertTriangle className="h-5 w-5 text-danger" />}
                title="Could not load tickets"
                description={ctx.loadError}
                action={<Button size="sm" onClick={ctx.reload}>Try again</Button>}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<InboxIcon className="h-5 w-5" />}
                title={ctx.loading ? 'Loading…' : 'Nothing here'}
                description={
                  ctx.loading
                    ? undefined
                    : q
                      ? 'No tickets match your search. Try a different term.'
                      : 'No tickets match this view.'
                }
                action={
                  <div className="flex gap-2">
                    {(activeFilters > 0 || q || view) && <Button size="sm" onClick={clearAll}>Reset</Button>}
                    {can('ticket.create') && (
                      <Button size="sm" variant="primary" onClick={ctx.newTicket}>
                        <Plus className="h-3.5 w-3.5" /> New ticket
                      </Button>
                    )}
                  </div>
                }
              />
            ) : (
              filtered.map((t) => (
                <TicketRow key={t.id} ticket={t} active={String(t.id) === ticketId} search={window.location.search} />
              ))
            )}
          </div>

          <div className="hidden shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-2xs text-ink-subtle md:flex">
            <span className="tabular-nums">{filtered.length} shown</span>
            <span className="ml-auto flex items-center gap-1.5">
              <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">j</kbd>
              <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">k</kbd>
              move
              <kbd className="ml-1 rounded border border-line bg-surface-2 px-1 font-mono">]</kbd>
              hide
            </span>
          </div>
        </div>

        {/* ─── Detail pane ─────────────────────────────────────────────────── */}
        <div className={cn('min-w-0 flex-1 bg-bg', !ticketId && 'hidden md:block')}>
          {ticketId ? (
            <Outlet context={ctx} />
          ) : (
            <EmptyState
              className="h-full"
              icon={<InboxIcon className="h-5 w-5" />}
              title="Select a ticket"
              description="Choose a conversation from the list to read it and reply."
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Collapsible filter group. The chevron rotates; the body is unmounted when
 *  closed so collapsed groups cost nothing to render. */
function Section({
  title, count, open, onToggle, children,
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="mb-1 border-b border-line pb-2 last-of-type:border-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-ctl px-1 py-1.5 text-left transition-colors hover:bg-surface-3"
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200', !open && '-rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
          {title}
        </span>
        {count != null && count > 0 && (
          <span className="shrink-0 rounded bg-brand-soft px-1.5 text-2xs font-semibold tabular-nums text-brand">
            {count}
          </span>
        )}
      </button>
      {open && <div className="mt-0.5 space-y-0.5 px-1">{children}</div>}
    </section>
  )
}

function TicketRow({ ticket, active, search }: { ticket: Ticket; active: boolean; search: string }) {
  const customer = api.customerById(ticket.customerId)
  const product = api.productById(ticket.productId)
  const status = api.statusByCode(ticket.statusCode)
  const priority = api.priorityByCode(ticket.priorityCode)
  const assignee = api.agentById(ticket.assigneeId)
  const last = ticket.messages[ticket.messages.length - 1]
  const overdue = api.isOverdue(ticket)
  const awaitingReply = last?.type === 'inbound_email'

  return (
    <Link
      to={`/inbox/${ticket.id}${search}`}
      className={cn(
        'relative flex gap-3 border-b border-line px-3 py-row transition-colors',
        active ? 'bg-brand-soft' : 'hover:bg-surface-2',
      )}
    >
      {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
      <span className="mt-0.5 shrink-0">
        <Avatar name={customer.name} color={product.color} size="sm" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[13px]', awaitingReply ? 'font-semibold text-ink' : 'font-medium text-ink')}>
            {customer.name}
          </span>
          <span className="shrink-0 text-2xs tabular-nums text-ink-subtle">{relativeTime(ticket.lastActivityAt)}</span>
        </span>

        <span className="mt-0.5 block truncate text-[13px] text-ink">{ticket.subject}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-subtle">{excerpt(last?.bodyHtml ?? '', 90)}</span>

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={status} />
          <PriorityBadge priority={priority} />
          <span className="inline-flex items-center gap-1 text-2xs text-ink-subtle">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: product.color }} />
            {ticket.number}
          </span>
          {overdue && (
            <span className="rounded bg-danger-soft px-1 py-px text-2xs font-semibold text-danger">Overdue</span>
          )}
          {ticket.tagIds.slice(0, 1).map((id) => {
            const tag = api.tagById(id)
            return tag ? <TagChip key={id} tag={tag} /> : null
          })}
          <span className="ml-auto shrink-0">
            {assignee ? (
              <Avatar name={assignee.name} color={assignee.avatarColor} size="xs" />
            ) : (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-subtle">
                <UserX className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
        </span>
      </span>
    </Link>
  )
}
