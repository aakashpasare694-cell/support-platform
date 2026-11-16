import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type Size = 'xs' | 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-brand-fg hover:bg-brand-hover shadow-sm disabled:bg-brand/50',
  secondary:
    'bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-strong shadow-sm',
  ghost: 'text-ink-muted hover:bg-surface-3 hover:text-ink',
  subtle: 'bg-surface-3 text-ink hover:bg-line',
  danger: 'bg-danger text-white hover:brightness-110 shadow-sm',
}

const SIZES: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1.5 rounded-ctl',
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-ctl',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-ctl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'sm', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  )
})

export function IconButton({
  className, label, ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant="ghost"
      className={cn('h-8 w-8 px-0', className)}
      {...props}
    />
  )
}
