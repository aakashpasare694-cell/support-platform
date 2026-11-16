import { NavLink } from 'react-router-dom'
import {
  BarChart3, Boxes, Inbox, LayoutDashboard, Mail, Settings2,
  Shield, Users, UsersRound,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Product } from '@/data/types'
import { cn } from '@/lib/cn'
import { useAuth } from '@/lib/auth'
import { ProductSwitcher } from './ProductSwitcher'
import type { Scope } from '@/hooks/useProductScope'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  permission?: string
  badge?: number
}

export function Sidebar({
  products, scope, onScopeChange, counts, onNavigate,
}: {
  products: Product[]
  scope: Scope
  onScopeChange: (s: Scope) => void
  counts: { inbox: number; unassigned: number }
  onNavigate?: () => void
}) {
  const { can, canReadTickets } = useAuth()

  const main: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-[17px] w-[17px]" /> },
    // Ticket access is a scope (assigned / team / all), so the menu asks the
    // same question the API does rather than checking one permission code.
    ...(canReadTickets
      ? [{ to: '/inbox', label: 'Inbox', icon: <Inbox className="h-[17px] w-[17px]" />, badge: counts.inbox }]
      : []),
    { to: '/customers', label: 'Customers', icon: <Users className="h-[17px] w-[17px]" />, permission: 'customer.view' },
    { to: '/reports', label: 'Reports', icon: <BarChart3 className="h-[17px] w-[17px]" />, permission: 'report.view' },
  ]

  const admin: NavItem[] = [
    { to: '/admin/products', label: 'Products', icon: <Boxes className="h-[17px] w-[17px]" />, permission: 'product.manage' },
    { to: '/admin/agents', label: 'Agents', icon: <UsersRound className="h-[17px] w-[17px]" />, permission: 'agent.manage' },
    { to: '/admin/teams', label: 'Teams', icon: <Shield className="h-[17px] w-[17px]" />, permission: 'team.manage' },
    { to: '/admin/roles', label: 'Roles & Permissions', icon: <Settings2 className="h-[17px] w-[17px]" />, permission: 'role.manage' },
  ]

  const settings: NavItem[] = [
    { to: '/settings/email-providers', label: 'Email Providers', icon: <Mail className="h-[17px] w-[17px]" />, permission: 'settings.email_providers.manage' },
  ]

  const visible = (items: NavItem[]) => items.filter((i) => !i.permission || can(i.permission))

  const renderGroup = (label: string, items: NavItem[]) => {
    const list = visible(items)
    if (!list.length) return null
    return (
      <div className="mt-5">
        <p className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">{label}</p>
        <nav className="space-y-0.5">{list.map(renderItem)}</nav>
      </div>
    )
  }

  const renderItem = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-brand-soft text-brand'
            : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
        )
      }
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-ink-muted group-hover:bg-surface">
          {item.badge}
        </span>
      )}
    </NavLink>
  )

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-surface-2">
      <div className="p-3">
        <ProductSwitcher products={products} scope={scope} onChange={onScopeChange} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <nav className="space-y-0.5">{visible(main).map(renderItem)}</nav>
        {renderGroup('Administration', admin)}
        {renderGroup('Settings', settings)}
      </div>

      {counts.unassigned > 0 && (
        <div className="border-t border-line p-3">
          <NavLink
            to="/inbox?view=unassigned"
            onClick={onNavigate}
            className="block rounded-lg border border-warning/25 bg-warning-soft px-2.5 py-2 transition-opacity hover:opacity-85"
          >
            <p className="text-2xs font-semibold uppercase tracking-wide text-warning">Unassigned</p>
            <p className="mt-0.5 text-[13px] font-medium text-ink">
              {counts.unassigned} ticket{counts.unassigned === 1 ? '' : 's'} waiting
            </p>
          </NavLink>
        </div>
      )}
    </aside>
  )
}
