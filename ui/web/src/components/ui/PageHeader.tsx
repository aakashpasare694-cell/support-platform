import type { ReactNode } from 'react'

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-5">{children}</div>
    </div>
  )
}

export function PageHeader({
  title, description, action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {action}
    </header>
  )
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}
