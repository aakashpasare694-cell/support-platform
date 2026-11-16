import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-surface-3', className)}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-black/[0.04] to-transparent dark:via-white/[0.06] animate-[shimmer_1.4s_infinite]" />
    </div>
  )
}

export function EmptyState({
  icon, title, description, action, className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon && (
        <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-ink-subtle">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export const Card = forwardRef<
  HTMLDivElement,
  { children: ReactNode; className?: string; padded?: boolean }
>(function Card({ children, className, padded = true }, ref) {
  return (
    <div ref={ref} className={cn('card', padded && 'p-4', className)}>
      {children}
    </div>
  )
})

export function SectionHeader({
  title, description, action, className,
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/** Inline key/value row used across the ticket sidebar and detail panels. */
export function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-ink-subtle">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] text-ink">{children}</span>
    </div>
  )
}
