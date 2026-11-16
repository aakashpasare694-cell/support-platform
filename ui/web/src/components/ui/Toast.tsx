import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'error' | 'info'
interface Toast { id: number; tone: Tone; title: string; detail?: string }

const ToastContext = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((all) => [...all, { ...t, id }])
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 4800)
  }, [])

  const value = useMemo(() => ({ push }), [push])

  const icons = {
    success: <CheckCircle2 className="h-4 w-4 text-success" />,
    error: <AlertTriangle className="h-4 w-4 text-danger" />,
    info: <Info className="h-4 w-4 text-info" />,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex animate-slide-up items-start gap-3 rounded-card border border-line',
              'bg-surface p-3 shadow-pop',
            )}
          >
            <span className="mt-0.5 shrink-0">{icons[t.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{t.title}</p>
              {t.detail && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{t.detail}</p>}
            </div>
            <button
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              className="shrink-0 text-ink-subtle transition-colors hover:text-ink"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
