import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Mail, Phone, Search, UserPlus, X } from 'lucide-react'
import { z } from 'zod'
import type { Customer, ID, Product } from '@/data/types'
import * as api from '@/data/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea, Help } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Avatar'
import { TagChip } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'

/** Mirrors the zod schema the API will validate against, so the two cannot drift. */
const schema = z
  .object({
    productId: z.number({ invalid_type_error: 'Choose a product.' }).int().positive('Choose a product.'),
    customerId: z.number().int().positive().nullable(),
    newCustomerName: z.string().trim(),
    newCustomerEmail: z.string().trim(),
    subject: z.string().trim().min(3, 'Give the ticket a subject of at least 3 characters.'),
    description: z.string().trim().min(1, 'Describe what the customer needs.'),
  })
  .superRefine((v, ctx) => {
    if (v.customerId != null) return
    if (!v.newCustomerName)
      ctx.addIssue({ code: 'custom', path: ['newCustomerName'], message: 'Enter the customer’s name.' })
    if (!v.newCustomerEmail)
      ctx.addIssue({ code: 'custom', path: ['newCustomerEmail'], message: 'Enter an email address.' })
    else if (!z.string().email().safeParse(v.newCustomerEmail).success)
      ctx.addIssue({ code: 'custom', path: ['newCustomerEmail'], message: 'That does not look like an email address.' })
  })

type Errors = Partial<Record<string, string>>

export function NewTicketModal({
  open, onClose, products, onCreated,
}: {
  open: boolean
  onClose: () => void
  products: Product[]
  onCreated: () => void
}) {
  const { user } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()

  const [productId, setProductId] = useState<ID | null>(products[0]?.id ?? null)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [customerId, setCustomerId] = useState<ID | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [statusCode, setStatusCode] = useState('open')
  const [priorityCode, setPriorityCode] = useState('medium')
  const [assigneeId, setAssigneeId] = useState<ID | null>(null)
  const [teamId, setTeamId] = useState<ID | null>(null)
  const [tagIds, setTagIds] = useState<ID[]>([])
  const [source, setSource] = useState<'manual' | 'phone' | 'email'>('phone')
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)

  // Reset every time the dialog opens, so a cancelled draft never leaks forward.
  useEffect(() => {
    if (!open) return
    setProductId(products[0]?.id ?? null)
    setMode('existing'); setCustomerId(null); setQuery('')
    setNewName(''); setNewEmail(''); setNewCompany('')
    setSubject(''); setDescription('')
    setStatusCode('open'); setPriorityCode('medium')
    setAssigneeId(null); setTeamId(null); setTagIds([]); setSource('phone')
    setErrors({})
  }, [open, products])

  useEffect(() => {
    if (!user || !open) return
    api.listCustomers(query).then((r) => setResults(r.slice(0, 6)))
  }, [user, query, open])

  // Assignment options follow the selected product — the same scoping the
  // backend applies, surfaced so an agent cannot pick someone without access.
  const assignable = useMemo(() => (productId ? api.assignableAgents(productId) : []), [productId])
  const teams = useMemo(
    () => (productId ? api.teamsForProduct(productId) : []),
    [productId],
  )

  useEffect(() => {
    if (assigneeId && !assignable.some((a) => a.id === assigneeId)) setAssigneeId(null)
    if (teamId && !teams.some((t) => t.id === teamId)) setTeamId(null)
  }, [assignable, teams, assigneeId, teamId])

  const selectedCustomer = customerId ? api.customerById(customerId) : null

  const submit = async () => {
    const parsed = schema.safeParse({
      productId: productId ?? Number.NaN,
      customerId: mode === 'existing' ? customerId : null,
      newCustomerName: mode === 'new' ? newName : 'x',
      newCustomerEmail: mode === 'new' ? newEmail : 'x@x.co',
      subject,
      description,
    })

    if (!parsed.success) {
      const next: Errors = {}
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message
      if (mode === 'existing' && customerId == null) next.customerId = 'Pick a customer, or add a new one.'
      setErrors(next)
      return
    }
    if (mode === 'existing' && customerId == null) {
      setErrors({ customerId: 'Pick a customer, or add a new one.' })
      return
    }

    setSaving(true)
    try {
      const ticket = await api.createTicket({
        productId: productId!,
        customerId: mode === 'existing' ? customerId : null,
        newCustomer: mode === 'new' ? { name: newName, email: newEmail, company: newCompany } : null,
        subject, description, statusCode, priorityCode, assigneeId, teamId, tagIds, source,
      })
      onCreated()
      onClose()
      push({
        tone: 'success',
        title: `${ticket.number} created`,
        detail: `${api.productById(ticket.productId).name} · ${api.customerById(ticket.customerId).name}`,
      })
      navigate(`/inbox/${ticket.id}`)
    } catch (err) {
      push({ tone: 'error', title: 'Could not create the ticket', detail: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const err = (k: string) =>
    errors[k] ? <p className="mt-1 text-xs text-danger">{errors[k]}</p> : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New ticket"
      description="Raise a ticket on a customer’s behalf — a phone call, a walk-in, or something you spotted yourself."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>Create ticket</Button>
        </>
      }
    >
      {/* Product first: it scopes assignment, teams and the sending address. */}
      <div className="mb-3">
        <Label>Product</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => setProductId(p.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-ctl border px-2 py-1 text-xs transition-colors',
                productId === p.id
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </button>
          ))}
          {productId && (
            <span className="ml-1 truncate text-2xs text-ink-subtle">
              {api.productById(productId).supportEmail} · {api.productById(productId).ticketPrefix}-####
            </span>
          )}
        </div>
        {err('productId')}
      </div>

      {/* Customer */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-ink">Customer</span>
          <div className="flex gap-0.5">
            <TabBtn active={mode === 'existing'} onClick={() => setMode('existing')} icon={<Search className="h-3 w-3" />} label="Find" />
            <TabBtn active={mode === 'new'} onClick={() => setMode('new')} icon={<UserPlus className="h-3 w-3" />} label="Add new" />
          </div>
        </div>

        {mode === 'existing' ? (
          selectedCustomer ? (
            <div className="flex items-center gap-2 rounded-ctl border border-line bg-surface-2 px-2 py-1.5">
              <Avatar name={selectedCustomer.name} color="#6b7280" size="xs" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {selectedCustomer.name}
                <span className="text-ink-subtle"> · {selectedCustomer.emails[0]}</span>
              </span>
              <button onClick={() => setCustomerId(null)} className="shrink-0 text-ink-subtle hover:text-ink" aria-label="Change customer">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)}
                       placeholder="Search name, email or company…" className="h-8 pl-8 text-[13px]" autoFocus />
              </div>
              <div className="mt-1 max-h-[108px] overflow-y-auto rounded-ctl border border-line">
                {results.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-ink-subtle">
                    No match — use <span className="font-medium text-ink">Add new</span>.
                  </p>
                ) : (
                  results.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setCustomerId(c.id); setErrors((e) => ({ ...e, customerId: undefined })) }}
                      className="flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-left transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <Avatar name={c.name} color="#6b7280" size="xs" />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {c.name}<span className="text-ink-subtle"> · {c.emails[0]}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              {err('customerId')}
            </>
          )
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" className="h-8 text-[13px]" />
              {err('newCustomerName')}
            </div>
            <div>
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" placeholder="name@company.com" className="h-8 text-[13px]" />
              {err('newCustomerEmail')}
            </div>
            <div className="col-span-2">
              <Input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Company (optional)" className="h-8 text-[13px]" />
            </div>
          </div>
        )}
      </div>

      {/* Two columns: the message on the left, its properties on the right.
          Keeps the whole form inside one screen on a 1280×800 laptop. */}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[1fr_210px]">
        <div className="min-w-0">
          <div className="mb-3">
            <Label htmlFor="nt-subject">Subject</Label>
            <Input id="nt-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                   placeholder="Short summary of the problem" className="h-8 text-[13px]" />
            {err('subject')}
          </div>
          <div>
            <Label htmlFor="nt-desc" hint="First message">Description</Label>
            <Textarea id="nt-desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)}
                      placeholder="What did the customer ask for?" className="text-[13px]" />
            {err('description')}
          </div>

          <div className="mt-3">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1">
              {api.tagsForProduct(productId).map((t) => {
                const on = tagIds.includes(t.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => setTagIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                    className={cn('rounded-ctl transition-opacity', on ? 'opacity-100' : 'opacity-40 hover:opacity-75')}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {on && <Check className="h-2.5 w-2.5" style={{ color: t.color }} />}
                      <TagChip tag={t} />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div>
            <Label htmlFor="nt-status">Status</Label>
            <Select id="nt-status" value={statusCode} onChange={(e) => setStatusCode(e.target.value)} className="h-8 text-[13px]">
              {api.statuses.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="nt-priority">Priority</Label>
            <Select id="nt-priority" value={priorityCode} onChange={(e) => setPriorityCode(e.target.value)} className="h-8 text-[13px]">
              {api.priorities.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="nt-source">Source</Label>
            <Select id="nt-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="h-8 text-[13px]">
              <option value="phone">Phone call</option>
              <option value="email">Email</option>
              <option value="manual">Raised by agent</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="nt-assignee" hint="This product">Assignee</Label>
            <Select id="nt-assignee" value={assigneeId ?? ''} className="h-8 text-[13px]"
                    onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned</option>
              {assignable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="nt-team">Team</Label>
            <Select id="nt-team" value={teamId ?? ''} className="h-8 text-[13px]"
                    onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
        </div>
      </div>

    </Modal>
  )
}

function TabBtn({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-ctl px-2 py-1 text-xs font-medium transition-colors',
        active ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
