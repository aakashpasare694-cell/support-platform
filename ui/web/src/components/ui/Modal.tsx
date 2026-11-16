import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'
import { lockBodyScroll } from '@/lib/scroll'

export function Modal({
  open, onClose, title, description, children, footer, size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const unlock = lockBodyScroll()

    // A reopened dialog should start at the top, not wherever it was left.
    // rAF so the scroller exists and has its height before we move it.
    const frame = requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (el) el.scrollTop = 0
    })

    return () => {
      document.removeEventListener('keydown', onKey)
      cancelAnimationFrame(frame)
      unlock()
    }
  }, [open, onClose])

  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }

  return (
    <div
      ref={scrollerRef}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto px-4 py-[4vh]"
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col animate-slide-up rounded-card',
          'border border-line bg-surface shadow-pop',
          widths[size],
        )}
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-1 -mt-1">
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="scroll-smooth-area min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 rounded-b-card border-t border-line bg-surface-2 px-5 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
