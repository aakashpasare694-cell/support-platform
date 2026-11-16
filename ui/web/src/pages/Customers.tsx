import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Mail, Phone, Search, Users } from 'lucide-react'
import type { Customer, Ticket } from '@/data/types'
import type { ShellContext } from '@/components/layout/AppShell'
import * as api from '@/data/api'
import { useAuth } from '@/lib/auth'
import { Page, PageHeader, Table } from '@/components/ui/PageHeader'
import { Card, EmptyState, Skeleton, DataRow } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Avatar'
import { StatusBadge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'
import { relativeTime } from '@/lib/format'

export function Customers() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Customer[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!user) return
    api.listCustomers(q).then(setRows)
  }, [user, q])

  return (
    <Page>
      <PageHeader
        title="Customers"
        description="One profile per person, with their product associations as rows — so somebody emailing about two products is still one customer."
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or company…" className="pl-9" />
      </div>

      {!rows ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<Users className="h-5 w-5" />} title="No customers found" description="Try a different search term." /></Card>
      ) : (
        <Table head={['Customer', 'Company', 'Products', 'Since', '']}>
          {rows.map((c) => (
            <tr key={c.id} className="transition-colors hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <Link to={`/customers/${c.id}`} className="flex items-center gap-2.5">
                  <Avatar name={c.name} color="#6b7280" size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-ink-subtle">{c.emails[0]}</span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-2.5 text-[13px] text-ink-muted">{c.company ?? '—'}</td>
              <td className="px-4 py-2.5">
                <span className="flex flex-wrap gap-1.5">
                  {c.productIds.map((id) => {
                    const p = api.productById(id)
                    return (
                      <span key={id} className="inline-flex items-center gap-1 text-xs text-ink-muted">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </span>
                    )
                  })}
                </span>
              </td>
              <td className="px-4 py-2.5 text-[13px] text-ink-subtle">{relativeTime(c.createdAt)} ago</td>
              <td className="px-4 py-2.5 text-right">
                <Link to={`/customers/${c.id}`} className="text-xs font-medium text-brand hover:underline">View</Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Page>
  )
}

export function CustomerDetail() {
  const { customerId } = useParams()
  const { user } = useAuth()
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const customer = api.customerById(Number(customerId))

  useEffect(() => {
    if (!user || !customerId) return
    api.ticketsForCustomer(Number(customerId)).then(setTickets)
  }, [user, customerId])

  if (!customer) return <EmptyState className="h-full" title="Customer not found" />

  return (
    <Page>
      <Link to="/customers" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All customers
      </Link>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <div className="flex items-center gap-3">
            <Avatar name={customer.name} color="#4f46e5" size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold text-ink">{customer.name}</h1>
              {customer.company && <p className="truncate text-[13px] text-ink-muted">{customer.company}</p>}
            </div>
          </div>

          <hr className="my-4 border-line" />
          <div className="space-y-0">
            {customer.emails.map((e) => (
              <DataRow key={e} label="Email">
                <span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 text-ink-subtle" />{e}</span>
              </DataRow>
            ))}
            {customer.phone && (
              <DataRow label="Phone">
                <span className="inline-flex items-center gap-1.5"><Phone className="h-3 w-3 text-ink-subtle" />{customer.phone}</span>
              </DataRow>
            )}
            {customer.company && (
              <DataRow label="Company">
                <span className="inline-flex items-center gap-1.5"><Building2 className="h-3 w-3 text-ink-subtle" />{customer.company}</span>
              </DataRow>
            )}
            <DataRow label="Timezone">{customer.timezone ?? '—'}</DataRow>
            <DataRow label="Customer since">{relativeTime(customer.createdAt)} ago</DataRow>
          </div>

          <hr className="my-4 border-line" />
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Products</p>
          <div className="space-y-1.5">
            {customer.productIds.map((id) => {
              const p = api.productById(id)
              return (
                <div key={id} className="flex items-center gap-2 text-[13px] text-ink">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
                </div>
              )
            })}
          </div>
        </Card>

        <Card padded={false}>
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">Ticket history</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Only tickets from products you may access are listed.</p>
          </div>
          {!tickets ? (
            <div className="p-4"><Skeleton className="h-40" /></div>
          ) : tickets.length === 0 ? (
            <EmptyState title="No tickets yet" description="This customer has not written in." />
          ) : (
            <div className="divide-y divide-line">
              {tickets.map((t) => (
                <Link key={t.id} to={`/inbox/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                  <span className="h-7 w-1 shrink-0 rounded-full" style={{ backgroundColor: api.productById(t.productId).color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{t.subject}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <StatusBadge status={api.statusByCode(t.statusCode)} />
                      <span className="font-mono text-2xs text-ink-subtle">{t.number}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-subtle">{relativeTime(t.lastActivityAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}
