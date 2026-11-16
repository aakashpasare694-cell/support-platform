import { cn } from '@/lib/cn'
import type { TicketPriority, TicketStatus, Tag } from '@/data/types'

/** Chip colour comes from the row, never from a hardcoded name map — an admin
 *  can add "Waiting on Third Party" and it renders correctly with no code
 *  change. How strongly that colour is tinted is the design direction's call,
 *  so the hue stays constant while the chip weight follows the theme. */
const tint = (color: string) => `color-mix(in srgb, ${color} var(--chip-tint), transparent)`
export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-semibold',
        className,
      )}
      style={{ backgroundColor: tint(status.color), color: status.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  )
}

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  const bars = Math.ceil(priority.weight / 10)
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-2xs font-semibold', className)}
      style={{ color: priority.color }}
      title={`Priority: ${priority.name}`}
    >
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-0.5 rounded-sm"
            style={{
              height: `${3 + i * 2}px`,
              backgroundColor: i <= bars ? priority.color : 'currentColor',
              opacity: i <= bars ? 1 : 0.22,
            }}
          />
        ))}
      </span>
      {priority.name}
    </span>
  )
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium"
      style={{ backgroundColor: tint(tag.color), color: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100" aria-label={`Remove ${tag.name}`}>
          ×
        </button>
      )}
    </span>
  )
}

export function Pill({
  children, tone = 'neutral', className,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
}) {
  const tones = {
    neutral: 'bg-surface-3 text-ink-muted',
    brand: 'bg-brand-soft text-brand',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-semibold', tones[tone], className)}>
      {children}
    </span>
  )
}
