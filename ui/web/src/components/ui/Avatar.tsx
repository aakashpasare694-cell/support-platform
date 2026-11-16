import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'

const SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
}

export function Avatar({
  name, color, size = 'sm', className, ring,
}: {
  name: string
  color?: string
  size?: keyof typeof SIZES
  className?: string
  ring?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase tracking-wide text-white',
        SIZES[size],
        ring && 'ring-2 ring-surface',
        className,
      )}
      style={{ backgroundColor: color ?? '#6b7280' }}
      title={name}
    >
      {initials(name)}
    </span>
  )
}
