import { ChevronsUpDown, Layers, Check } from 'lucide-react'
import type { Product } from '@/data/types'
import { Menu, MenuDivider, MenuLabel } from '@/components/ui/Menu'
import { cn } from '@/lib/cn'
import type { Scope } from '@/hooks/useProductScope'

/**
 * Switches the whole app between one product and the combined view.
 * Only products the agent is authorized for are listed — and the backend
 * re-checks on every request, so this is convenience, not security.
 */
export function ProductSwitcher({
  products, scope, onChange,
}: {
  products: Product[]
  scope: Scope
  onChange: (next: Scope) => void
}) {
  const active = scope == null ? null : products.find((p) => p.id === scope) ?? null

  return (
    <Menu
      width="w-[244px]"
      trigger={(open) => (
        <button
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2',
            'text-left transition-colors hover:border-line-strong hover:bg-surface-2',
            open && 'border-line-strong bg-surface-2',
          )}
        >
          {active ? (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
              style={{ backgroundColor: active.color }}
            >
              {active.ticketPrefix.slice(0, 2)}
            </span>
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink/85 text-white dark:bg-surface-3 dark:text-ink">
              <Layers className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight text-ink">
              {active ? active.name : 'All Products'}
            </span>
            <span className="block truncate text-2xs leading-tight text-ink-subtle">
              {active ? active.supportEmail : `${products.length} products`}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Workspace</MenuLabel>
          <button
            onClick={() => { onChange(null); close() }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-3"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink/85 text-white dark:bg-surface-3 dark:text-ink">
              <Layers className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">All Products</span>
              <span className="block text-2xs text-ink-subtle">Combined inbox</span>
            </span>
            {scope == null && <Check className="h-3.5 w-3.5 text-brand" />}
          </button>

          <MenuDivider />
          <MenuLabel>Products</MenuLabel>
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => { onChange(p.id); close() }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-3"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.ticketPrefix.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
                <span className="block truncate text-2xs text-ink-subtle">{p.supportEmail}</span>
              </span>
              {scope === p.id && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
            </button>
          ))}
        </>
      )}
    </Menu>
  )
}
