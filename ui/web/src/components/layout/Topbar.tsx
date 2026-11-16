import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, LogOut, Menu as MenuIcon, Moon, Palette, Plus, Search, Sun } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { Menu, MenuDivider, MenuItem, MenuLabel } from '@/components/ui/Menu'
import { Pill } from '@/components/ui/Badge'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/hooks/useTheme'
import { useDesign } from '@/hooks/useDesign'
import type { Product } from '@/data/types'

export function Topbar({
  products, onOpenSidebar, onNewTicket,
}: {
  products: Product[]
  onOpenSidebar: () => void
  onNewTicket: () => void
}) {
  const { user, signOut, can } = useAuth()
  const { theme, toggle } = useTheme()
  const { design, select, designs } = useDesign()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" focuses search the way every tool an agent already uses does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (!user) return null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(`/inbox?q=${encodeURIComponent(query)}`)
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4">
      <IconButton label="Open navigation" onClick={onOpenSidebar} className="lg:hidden">
        <MenuIcon className="h-4 w-4" />
      </IconButton>

      <form onSubmit={submit} className="relative min-w-0 flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tickets, customers, email…"
          className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-10 text-[13px] text-ink
                     placeholder:text-ink-subtle transition-colors focus:border-brand focus:bg-surface
                     focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line
                        bg-surface px-1.5 py-0.5 font-mono text-2xs text-ink-subtle sm:block">
          /
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-1">
        {can('ticket.create') && (
          <Button variant="primary" size="sm" onClick={onNewTicket} className="mr-1">
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New ticket</span>
          </Button>
        )}

        <Menu
          align="right"
          width="w-[300px]"
          trigger={() => (
            <IconButton label="Change design direction">
              <Palette className="h-4 w-4" />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Design direction</MenuLabel>
              {designs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { select(d.id); close() }}
                  className="flex w-full items-start gap-2.5 rounded-ctl px-2.5 py-2 text-left transition-colors hover:bg-surface-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-medium text-ink">{d.name}</span>
                      <span className="text-2xs text-ink-subtle">{d.tagline}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{d.description}</span>
                  </span>
                  {design === d.id && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />}
                </button>
              ))}
            </>
          )}
        </Menu>

        <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </IconButton>

        <Menu
          align="right"
          width="w-64"
          trigger={() => (
            <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-3">
              <Avatar name={user.name} color={user.avatarColor} size="sm" />
              <span className="hidden min-w-0 text-left sm:block">
                <span className="block truncate text-[13px] font-medium leading-tight text-ink">{user.name}</span>
                <span className="block truncate text-2xs leading-tight text-ink-subtle">{user.jobTitle}</span>
              </span>
            </button>
          )}
        >
          {() => (
            <>
              <div className="px-2.5 py-2">
                <p className="text-[13px] font-semibold text-ink">{user.name}</p>
                <p className="truncate text-xs text-ink-muted">{user.email}</p>
              </div>
              <MenuDivider />
              <MenuLabel>Product access</MenuLabel>
              <div className="flex flex-wrap gap-1 px-2.5 pb-2 pt-0.5">
                {products.map((p) => (
                  <Pill key={p.id} tone="neutral">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </Pill>
                ))}
              </div>
              <MenuDivider />
              <MenuItem icon={<LogOut className="h-3.5 w-3.5" />} onClick={signOut} danger>
                Sign out
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </header>
  )
}
