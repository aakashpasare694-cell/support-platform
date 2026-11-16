import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Lightweight popover menu: click-outside and Escape both close it. */
export function Menu({
  trigger, children, align = 'left', width = 'w-56', className,
}: {
  trigger: (open: boolean) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  width?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div onClick={() => setOpen((v) => !v)}>{trigger(open)}</div>
      {open && (
        <div
          className={cn(
            'absolute z-50 mt-1.5 overflow-hidden rounded-card border border-line bg-surface p-1 shadow-pop',
            'animate-slide-down',
            width,
            align === 'right' ? 'right-0' : 'left-0',
          )}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  children, onClick, selected, danger, icon, disabled,
}: {
  children: ReactNode
  onClick?: () => void
  selected?: boolean
  danger?: boolean
  icon?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-ctl px-2.5 py-[7px] text-left text-[13px] transition-colors',
        'disabled:pointer-events-none disabled:opacity-45',
        danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-surface-3',
      )}
    >
      {icon && <span className="shrink-0 text-ink-subtle">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">{children}</div>
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />
}
