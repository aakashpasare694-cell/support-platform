import { useEffect, useState } from 'react'
import { Table2 } from 'lucide-react'
import * as api from '@/data/api'
import type { Overview } from '@/data/api'
import { useAuth } from '@/lib/auth'
import { Page, PageHeader, Table } from '@/components/ui/PageHeader'
import { Card, SectionHeader, Skeleton } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/ui/Badge'
import { BarRow, LineChart, SeriesTable } from '@/components/charts/LineChart'

export function Reports() {
  const { user } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    if (!user) return
    api.overview().then(setData)
  }, [user])

  if (!data) {
    return <Page><Skeleton className="h-8 w-48" /><div className="mt-4 space-y-4"><Skeleton className="h-64" /><Skeleton className="h-64" /></div></Page>
  }

  const series = [
    { key: 'created', label: 'Created', color: 'rgb(var(--chart-1))', values: data.volume.map((v) => v.created) },
    { key: 'resolved', label: 'Resolved', color: 'rgb(var(--chart-2))', values: data.volume.map((v) => v.resolved) },
  ]
  const maxProduct = Math.max(1, ...data.byProduct.map((r) => r.total))
  const maxStatus = Math.max(1, ...data.byStatus.map((r) => r.count))
  const resolvedTotal = data.byStatus
    .filter((s) => api.statusByCode(s.code).isResolved)
    .reduce((a, b) => a + b.count, 0)
  const rate = data.total ? Math.round((resolvedTotal / data.total) * 100) : 0
  const fr = data.avgFirstResponseMins

  return (
    <Page>
      <PageHeader
        title="Reports"
        description="Support performance across every product you are authorized to see."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total tickets', value: data.total, hint: 'All time' },
          { label: 'Resolution rate', value: `${rate}%`, hint: `${resolvedTotal} resolved or closed` },
          { label: 'Avg first response', value: fr >= 60 ? `${Math.floor(fr / 60)}h ${fr % 60}m` : `${fr}m`, hint: 'Across responded tickets' },
          { label: 'Open right now', value: data.open, hint: `${data.unassigned} unassigned` },
        ].map((s) => (
          <Card key={s.label}>
            <p className="text-[13px] font-medium text-ink-muted">{s.label}</p>
            <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-ink">{s.value}</p>
            <p className="mt-1.5 text-xs text-ink-subtle">{s.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-4">
        <SectionHeader
          title="Created vs resolved"
          description="Last 14 days"
          action={
            <Button size="xs" variant="ghost" onClick={() => setShowTable((v) => !v)}>
              <Table2 className="h-3.5 w-3.5" />{showTable ? 'Chart' : 'Table'}
            </Button>
          }
        />
        <div className="mt-4">
          {showTable
            ? <SeriesTable labels={data.volume.map((v) => v.day)} series={series} />
            : <LineChart labels={data.volume.map((v) => v.day)} series={series} height={220} />}
        </div>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Tickets by product" />
          <div className="mt-3 space-y-0.5">
            {data.byProduct.map((r) => (
              <BarRow key={r.productId} label={r.name} value={r.total} max={maxProduct}
                      color={r.color} hint={`${r.open} currently open`} />
            ))}
          </div>
        </Card>
        <Card>
          <SectionHeader title="Tickets by status" />
          <div className="mt-3 space-y-0.5">
            {data.byStatus.map((r) => (
              <BarRow key={r.code} label={<StatusBadge status={api.statusByCode(r.code)} />} value={r.count}
                      max={maxStatus} color={r.color} />
            ))}
          </div>
        </Card>
      </div>

      <div>
        <h2 className="mb-2.5 text-[15px] font-semibold tracking-tight text-ink">Agent performance</h2>
        <Table head={['Agent', 'Title', 'Open assigned', 'Resolved', 'Share of resolved']}>
          {data.byAgent.map((r) => {
            const totalResolved = Math.max(1, data.byAgent.reduce((a, b) => a + b.resolved, 0))
            const pct = Math.round((r.resolved / totalResolved) * 100)
            const agent = api.agentById(r.agentId)
            return (
              <tr key={r.agentId} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={r.name} color={r.avatarColor ?? '#6b7280'} size="sm" />
                    <span className="truncate text-[13px] font-medium text-ink">{r.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-[13px] text-ink-muted">{agent?.jobTitle ?? '—'}</td>
                <td className="px-4 py-2.5 text-[13px] font-semibold tabular-nums text-ink">{r.assigned}</td>
                <td className="px-4 py-2.5 text-[13px] font-semibold tabular-nums text-success">{r.resolved}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-xs tabular-nums text-ink-muted">{pct}%</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </Table>
      </div>
    </Page>
  )
}
