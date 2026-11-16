import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Inbox, Table2, TrendingUp, UserX,
} from 'lucide-react'
import type { ShellContext } from '@/components/layout/AppShell'
import { useAuth } from '@/lib/auth'
import * as api from '@/data/api'
import type { Overview } from '@/data/api'
import { Card, SectionHeader, Skeleton } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { BarRow, LineChart, SeriesTable } from '@/components/charts/LineChart'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'

function Stat({
  label, value, icon, tone = 'neutral', hint, to,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone?: 'neutral' | 'warning' | 'danger' | 'success'
  hint?: string
  to?: string
}) {
  const tones = {
    neutral: 'text-ink-muted bg-surface-3',
    warning: 'text-warning bg-warning-soft',
    danger: 'text-danger bg-danger-soft',
    success: 'text-success bg-success-soft',
  }
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>
        {to && <ArrowUpRight className="h-3.5 w-3.5 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 text-[13px] font-medium text-ink-muted">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>}
    </>
  )
  return to ? (
    <Link to={to} className="card group p-4 transition-colors hover:border-line-strong hover:bg-surface-2">{inner}</Link>
  ) : (
    <Card className="group">{inner}</Card>
  )
}

export function Dashboard() {
  const { user } = useAuth()
  const { scope, products, tickets } = useOutletContext<ShellContext>()
  const [data, setData] = useState<Overview | null>(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    if (!user) return
    setData(null)
    api.overview().then(setData)
  }, [user])

  // Oldest open tickets nobody has replied to yet. Computed before any early
  // return so hook order stays stable across renders.
  const attention = useMemo(
    () =>
      tickets
        .filter((t) => api.statusByCode(t.statusCode).isOpen && !t.firstRespondedAt)
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
        .slice(0, 6),
    [tickets],
  )

  const scopedProducts = scope == null ? products : products.filter((p) => p.id === scope)
  const title = scope == null ? 'All Products' : products.find((p) => p.id === scope)?.name ?? ''

  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-8 w-56" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[118px]" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  const byProduct = data.byProduct.filter((r) => scope == null || r.productId === scope)
  const maxProduct = Math.max(1, ...byProduct.map((r) => r.total))
  const maxStatus = Math.max(1, ...data.byStatus.map((r) => r.count))
  const maxPriority = Math.max(1, ...data.byPriority.map((r) => r.count))
  const maxAgent = Math.max(1, ...data.byAgent.map((r) => r.assigned + r.resolved))

  const frHours = Math.floor(data.avgFirstResponseMins / 60)
  const frMins = data.avgFirstResponseMins % 60

  const chartSeries = [
    { key: 'created', label: 'Created', color: 'rgb(var(--chart-1))', values: data.volume.map((v) => v.created) },
    { key: 'resolved', label: 'Resolved', color: 'rgb(var(--chart-2))', values: data.volume.map((v) => v.resolved) },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-5">
        <header className="mb-5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-subtle">{title}</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink">
            Good to see you, {user!.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {data.unassigned > 0
              ? `${data.unassigned} ticket${data.unassigned === 1 ? '' : 's'} still need an owner.`
              : 'Every open ticket has an owner.'}
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Open tickets" value={data.open} icon={<Inbox className="h-4 w-4" />} to="/inbox" />
          <Stat label="Unassigned" value={data.unassigned} tone={data.unassigned ? 'warning' : 'neutral'}
                icon={<UserX className="h-4 w-4" />} to="/inbox?view=unassigned" />
          <Stat label="Overdue first reply" value={data.overdue} tone={data.overdue ? 'danger' : 'success'}
                icon={<AlertTriangle className="h-4 w-4" />} hint="Past the first-response target" to="/inbox?view=overdue" />
          <Stat label="Resolved (24h)" value={data.resolvedToday} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
          <Stat label="Avg first response" value={frHours > 0 ? `${frHours}h ${frMins}m` : `${frMins}m`}
                icon={<Clock className="h-4 w-4" />} hint="Across responded tickets" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <SectionHeader
              title="Ticket volume"
              description="Created against resolved, last 14 days"
              action={
                <Button size="xs" variant="ghost" onClick={() => setShowTable((v) => !v)}>
                  <Table2 className="h-3.5 w-3.5" />
                  {showTable ? 'Chart' : 'Table'}
                </Button>
              }
            />
            <div className="mt-4">
              {showTable
                ? <SeriesTable labels={data.volume.map((v) => v.day)} series={chartSeries} />
                : <LineChart labels={data.volume.map((v) => v.day)} series={chartSeries} />}
            </div>
          </Card>

          <Card>
            <SectionHeader title="By status" description="Across all tickets" />
            <div className="mt-3 space-y-0.5">
              {data.byStatus.map((r) => (
                <BarRow
                  key={r.code}
                  label={<StatusBadge status={api.statusByCode(r.code)} />}
                  value={r.count}
                  max={maxStatus}
                  color={r.color}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card>
            <SectionHeader title="Open by priority" />
            <div className="mt-3 space-y-0.5">
              {data.byPriority.map((r) => (
                <BarRow key={r.code} label={r.name} value={r.count} max={maxPriority} color={r.color} />
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader title="By product" description={scope == null ? 'Combined view' : 'Current product'} />
            <div className="mt-3 space-y-0.5">
              {byProduct.map((r) => (
                <BarRow
                  key={r.productId}
                  label={r.name}
                  value={r.total}
                  max={maxProduct}
                  color={r.color}
                  hint={`${r.open} open of ${r.total}`}
                />
              ))}
            </div>
            {scopedProducts.length > 1 && (
              <p className="mt-3 border-t border-line pt-2.5 text-xs text-ink-subtle">
                You have access to {scopedProducts.length} products. Switch at the top left to focus on one.
              </p>
            )}
          </Card>

          <Card>
            <SectionHeader title="Agent workload" description="Open assigned vs resolved" />
            <div className="mt-3 space-y-1.5">
              {data.byAgent.slice(0, 6).map((r) => (
                <div key={r.agentId} className="flex items-center gap-2.5">
                  <Avatar name={r.name} color={r.avatarColor ?? '#6b7280'} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                    <span className="font-semibold text-ink">{r.assigned}</span> open
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-success">
                    {r.resolved} done
                  </span>
                </div>
              ))}
              {data.byAgent.length === 0 && (
                <p className="py-3 text-center text-xs text-ink-subtle">No assignments yet.</p>
              )}
            </div>
          </Card>
        </div>

        <Card className="mt-4">
          <SectionHeader
            title="Needs attention first"
            description="Oldest open tickets without a reply"
            action={<Link to="/inbox" className="text-xs font-medium text-brand hover:underline">Open inbox</Link>}
          />
          <div className="mt-3 divide-y divide-line">
            {attention.map((t) => {
              const customer = api.customerById(t.customerId)
              const product = api.productById(t.productId)
              return (
                <Link key={t.id} to={`/inbox/${t.id}`} className="flex items-center gap-3 py-2.5 transition-colors hover:bg-surface-2">
                  <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: product.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{t.subject}</span>
                    <span className="block truncate text-xs text-ink-subtle">
                      {t.number} · {customer.name} · {product.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-subtle">{relativeTime(t.createdAt)}</span>
                  {api.isOverdue(t) && (
                    <span className="shrink-0 rounded-md bg-danger-soft px-1.5 py-0.5 text-2xs font-semibold text-danger">
                      Overdue
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </Card>

        <p className="mt-6 flex items-center justify-center gap-1.5 pb-2 text-xs text-ink-subtle">
          <TrendingUp className="h-3.5 w-3.5" />
          Figures reflect only the products you are authorized to see.
        </p>
      </div>
    </div>
  )
}
