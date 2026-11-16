import { useState } from 'react'
import { AlertTriangle, ArrowRight, Inbox, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Field'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      // The API answers 401 for both a wrong password and an unknown address,
      // so the message here stays equally vague on purpose.
      const message = err instanceof Error ? err.message : 'Could not sign in'
      setError(message)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full">
      {/* ─── Brand panel ─────────────────────────────────────────────────── */}
      <div className="relative hidden w-[46%] shrink-0 overflow-hidden bg-ink lg:flex lg:flex-col dark:bg-surface-2">
        <div
          className="absolute inset-0 opacity-[0.17]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 22%, #6366f1 0, transparent 42%), radial-gradient(circle at 82% 78%, #0d9488 0, transparent 45%)',
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 backdrop-blur">
              <Inbox className="h-4 w-4 text-white" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-white">Helpdesk</span>
          </div>

          <div className="max-w-md">
            <h1 className="text-[30px] font-semibold leading-[1.18] tracking-tight text-white">
              Every product&rsquo;s support,
              <br />
              in one inbox.
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              Email from each of your products arrives here, becomes a ticket, and is worked by
              the agents you authorize &mdash; nothing more.
            </p>
          </div>

          <p className="text-xs text-white/35">Internal tool &middot; Authorized agents only</p>
        </div>
      </div>

      {/* ─── Form ────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand">
              <Inbox className="h-4 w-4 text-brand-fg" />
            </span>
          </div>

          <h2 className="text-[22px] font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1.5 text-[13px] text-ink-muted">Use your agent account to continue.</p>

          <form className="mt-7" onSubmit={submit}>
            <div className="mb-4">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                placeholder="you@company.com"
              />
            </div>
            <div className="mb-5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="mb-4 flex items-start gap-2 rounded-ctl bg-danger-soft px-3 py-2 text-[13px] text-danger">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              loading={busy}
              disabled={!email.trim() || !password}
            >
              Sign in
              {!busy && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </form>

          <p className="mt-7 flex items-start gap-2 text-xs leading-relaxed text-ink-subtle">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
            Product access and ticket visibility are enforced by the backend on every request —
            hiding a menu is never the control.
          </p>
        </div>
      </div>
    </div>
  )
}
