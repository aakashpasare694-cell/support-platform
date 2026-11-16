import { useEffect, useRef, useState } from 'react'
import { Check, Plus, Shield, Trash2, X } from 'lucide-react'
import type { Agent, ID, Product, Team } from '@/data/types'
import * as api from '@/data/api'
import { useAuth } from '@/lib/auth'
import { Page, PageHeader, Table } from '@/components/ui/PageHeader'
import { Card, Skeleton, SectionHeader } from '@/components/ui/Feedback'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Label, Select, Textarea, Toggle, Help } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { scrollIntoView } from '@/lib/scroll'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'

/** Turns an ApiError's field details into something a form can show inline. */
function fieldErrors(err: unknown): Record<string, string> {
  const details = (err as { details?: Record<string, string> })?.details
  if (details && typeof details === 'object') return details
  return { _: err instanceof Error ? err.message : 'Something went wrong' }
}

function FormError({ errors, field }: { errors: Record<string, string>; field: string }) {
  if (!errors[field]) return null
  return <p className="mt-1 text-xs text-danger">{errors[field]}</p>
}

// ─── Products ───────────────────────────────────────────────────────────────

export function Products() {
  const { products, refreshProducts, can } = useAuth()
  const { push } = useToast()
  const [editing, setEditing] = useState<Product | 'new' | null>(null)

  return (
    <Page>
      <PageHeader
        title="Products"
        description="Products are rows, never code. Adding one here makes it available everywhere — no deploy, and nothing in the business logic branches on its name."
        action={
          can('product.manage') ? (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" /> Add product
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-xs font-bold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.ticketPrefix}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[14px] font-semibold text-ink">{p.name}</h3>
                <p className="truncate text-xs text-ink-muted">{p.supportEmail ?? 'No inbound address'}</p>
              </div>
              {p.isActive ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
            </div>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-ink-subtle">Ticket prefix</dt>
                <dd className="font-mono text-ink">{p.ticketPrefix}-####</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-subtle">Slug</dt>
                <dd className="font-mono text-ink">{p.slug}</dd>
              </div>
            </dl>
            {can('product.manage') && (
              <Button size="xs" className="mt-3 w-full" onClick={() => setEditing(p)}>
                Edit
              </Button>
            )}
          </Card>
        ))}
      </div>

      <ProductModal
        open={editing != null}
        product={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={async (name) => {
          await refreshProducts()
          setEditing(null)
          push({ tone: 'success', title: `${name} saved` })
        }}
      />
    </Page>
  )
}

function ProductModal({
  open, product, onClose, onSaved,
}: {
  open: boolean
  product: Product | null
  onClose: () => void
  onSaved: (name: string) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [color, setColor] = useState('#4f46e5')
  const [email, setEmail] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setName(product?.name ?? '')
    setPrefix(product?.ticketPrefix ?? '')
    setColor(product?.color ?? '#4f46e5')
    setEmail(product?.supportEmail ?? '')
    setActive(product?.isActive ?? true)
    setErrors({})
  }, [open, product])

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      const body = { name, ticketPrefix: prefix, color, supportEmail: email || undefined, isActive: active }
      if (product) await api.updateProduct(product.id, body)
      else await api.createProduct(body)
      await onSaved(name)
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? `Edit ${product.name}` : 'Add product'}
      description="The ticket prefix appears on every ticket number for this product."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save product</Button>
        </>
      }
    >
      {errors._ && <p className="mb-3 rounded-ctl bg-danger-soft px-3 py-2 text-[13px] text-danger">{errors._}</p>}
      <div className="mb-3">
        <Label htmlFor="p-name">Name</Label>
        <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Charity ERP" className="h-8 text-[13px]" />
        <FormError errors={errors} field="name" />
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="p-prefix" hint="e.g. ERP-1024">Ticket prefix</Label>
          <Input id="p-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                 placeholder="ERP" maxLength={10} className="h-8 text-[13px]" />
          <FormError errors={errors} field="ticketPrefix" />
        </div>
        <div>
          <Label htmlFor="p-color">Colour</Label>
          <div className="flex gap-2">
            <input id="p-color" type="color" value={color} onChange={(e) => setColor(e.target.value)}
                   className="h-8 w-12 cursor-pointer rounded-ctl border border-line bg-surface p-1" />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="h-8 font-mono text-[13px]" />
          </div>
          <FormError errors={errors} field="color" />
        </div>
      </div>
      <div className="mb-3">
        <Label htmlFor="p-email" hint="Optional">Inbound address</Label>
        <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
               placeholder="support@product.com" className="h-8 text-[13px]" />
        <Help>Email arriving here becomes a ticket on this product.</Help>
        <FormError errors={errors} field="supportEmail" />
      </div>
      <div className="flex items-center gap-2">
        <Toggle checked={active} onChange={setActive} label="Active" />
        <span className="text-[13px] text-ink">Active</span>
        <span className="text-xs text-ink-subtle">— deactivating hides it and its tickets from everyone</span>
      </div>
    </Modal>
  )
}

// ─── Agents ─────────────────────────────────────────────────────────────────

export function Agents() {
  const { products, can } = useAuth()
  const { push } = useToast()
  const [rows, setRows] = useState<Agent[] | null>(null)
  const [editing, setEditing] = useState<Agent | 'new' | null>(null)

  const load = () => api.listAgents().then(setRows)
  useEffect(() => {
    void load()
  }, [])

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="A role is granted on a product. One agent can be a manager on one product and see only their own tickets on another; a global grant covers every product."
        action={
          can('agent.manage') ? (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" /> Invite agent
            </Button>
          ) : undefined
        }
      />
      {!rows ? (
        <Skeleton className="h-72" />
      ) : (
        <Table head={['Agent', 'Access', 'Last active', 'Status', '']}>
          {rows.map((a) => (
            <tr key={a.id} className={cn('transition-colors hover:bg-surface-2', !a.isActive && 'opacity-60')}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={a.name} color={a.avatarColor ?? '#6b7280'} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{a.name}</p>
                    <p className="truncate text-xs text-ink-subtle">{a.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {a.productRoles.map((r, i) => (
                    <Pill key={i} tone={r.productId === null ? 'brand' : 'neutral'}>
                      {r.productId === null
                        ? 'All products'
                        : products.find((p) => p.id === r.productId)?.name ?? `#${r.productId}`}
                      {' · '}
                      {r.roleName ?? r.roleCode}
                    </Pill>
                  ))}
                </div>
              </td>
              <td className="px-4 py-2.5 text-[13px] text-ink-subtle">
                {a.lastActiveAt ? `${relativeTime(a.lastActiveAt)} ago` : 'Never'}
              </td>
              <td className="px-4 py-2.5">
                {a.isActive ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Deactivated</Pill>}
              </td>
              <td className="px-4 py-2.5 text-right">
                {can('agent.manage') && <Button size="xs" onClick={() => setEditing(a)}>Edit</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <AgentModal
        open={editing != null}
        agent={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={async (name, tempPassword) => {
          await load()
          setEditing(null)
          push({
            tone: 'success',
            title: `${name} saved`,
            // Shown once: only the hash is stored, so it cannot be retrieved later.
            detail: tempPassword
              ? `Temporary password: ${tempPassword} — share it now, it is not recoverable.`
              : undefined,
          })
        }}
      />
    </Page>
  )
}

function AgentModal({
  open, agent, onClose, onSaved,
}: {
  open: boolean
  agent: Agent | null
  onClose: () => void
  onSaved: (name: string, tempPassword?: string) => void | Promise<void>
}) {
  const { products } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [password, setPassword] = useState('')
  const [active, setActive] = useState(true)
  const [grants, setGrants] = useState<api.AgentGrant[]>([])
  const [roles, setRoles] = useState<{ code: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setName(agent?.name ?? '')
    setEmail(agent?.email ?? '')
    setJobTitle(agent?.jobTitle ?? '')
    setPassword('')
    setActive(agent?.isActive ?? true)
    setGrants(agent?.productRoles.map((r) => ({ productId: r.productId, roleCode: r.roleCode })) ?? [])
    setErrors({})
    api.loadRoles().then((p) => setRoles(p.roles.map((r) => ({ code: r.code, name: r.name }))))
  }, [open, agent])

  const setGrant = (productId: ID | null, roleCode: string) => {
    setGrants((prev) => {
      const rest = prev.filter((g) => g.productId !== productId)
      return roleCode ? [...rest, { productId, roleCode }] : rest
    })
  }
  const grantFor = (productId: ID | null) => grants.find((g) => g.productId === productId)?.roleCode ?? ''

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      const body: api.AgentInput = {
        name,
        email,
        jobTitle: jobTitle || undefined,
        grants,
        isActive: active,
        ...(password ? { password } : {}),
      }
      if (agent) {
        await api.updateAgent(agent.id, body)
        await onSaved(name)
      } else {
        const res = await api.createAgent(body)
        await onSaved(name, res.initialPassword)
      }
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={agent ? `Edit ${agent.name}` : 'Invite agent'}
      description="Access is granted per product. Leave a product unset to give no access at all."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save agent</Button>
        </>
      }
    >
      {errors._ && <p className="mb-3 rounded-ctl bg-danger-soft px-3 py-2 text-[13px] text-danger">{errors._}</p>}
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="a-name">Name</Label>
          <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-[13px]" />
          <FormError errors={errors} field="name" />
        </div>
        <div>
          <Label htmlFor="a-email">Work email</Label>
          <Input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 disabled={!!agent} className="h-8 text-[13px]" />
          <FormError errors={errors} field="email" />
        </div>
        <div>
          <Label htmlFor="a-title" hint="Optional">Job title</Label>
          <Input id="a-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="h-8 text-[13px]" />
        </div>
        <div>
          <Label htmlFor="a-pass" hint={agent ? 'Blank keeps it' : 'Optional'}>Password</Label>
          <Input id="a-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 placeholder={agent ? '••••••••' : 'Generated if blank'} className="h-8 text-[13px]" />
          <FormError errors={errors} field="password" />
        </div>
      </div>

      <div className="mb-3">
        <Label hint="Broadest grant wins">Access per product</Label>
        <div className="divide-y divide-line rounded-ctl border border-line">
          <GrantRow label="All products" hint="A global grant, applied everywhere"
                    value={grantFor(null)} roles={roles} onChange={(r) => setGrant(null, r)} />
          {products.map((p) => (
            <GrantRow key={p.id} label={p.name} color={p.color} value={grantFor(p.id)} roles={roles}
                      onChange={(r) => setGrant(p.id, r)} />
          ))}
        </div>
        <Help>
          Ticket visibility comes from the role: Junior Agent sees only tickets assigned to them, Team Lead sees
          their teams’, and the rest see the whole product.
        </Help>
        <FormError errors={errors} field="grants" />
      </div>

      <div className="flex items-center gap-2">
        <Toggle checked={active} onChange={setActive} label="Active" />
        <span className="text-[13px] text-ink">Active</span>
        <span className="text-xs text-ink-subtle">— deactivating signs them out everywhere immediately</span>
      </div>
    </Modal>
  )
}

function GrantRow({
  label, hint, color, value, roles, onChange,
}: {
  label: string
  hint?: string
  color?: string
  value: string
  roles: { code: string; name: string }[]
  onChange: (roleCode: string) => void
}) {
  return (
    <div className="flex items-center gap-3 px-2.5 py-1.5">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink">{label}</span>
          {hint && <span className="block truncate text-2xs text-ink-subtle">{hint}</span>}
        </span>
      </span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-[178px] text-[13px]">
        <option value="">No access</option>
        {roles.map((r) => (
          <option key={r.code} value={r.code}>{r.name}</option>
        ))}
      </Select>
    </div>
  )
}

// ─── Teams ──────────────────────────────────────────────────────────────────

export function Teams() {
  const { products, can } = useAuth()
  const { push } = useToast()
  const [rows, setRows] = useState<Team[] | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [editing, setEditing] = useState<Team | 'new' | null>(null)

  const load = () => Promise.all([api.listTeams().then(setRows), api.listAgents().then(setAgents)])
  useEffect(() => {
    void load()
  }, [])

  return (
    <Page>
      <PageHeader
        title="Teams"
        description="Teams can belong to one product or span all of them. Tickets are assignable to a team as well as to an individual."
        action={
          can('team.manage') ? (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" /> Create team
            </Button>
          ) : undefined
        }
      />
      {!rows ? (
        <Skeleton className="h-56" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((t) => {
            const product = t.productId ? products.find((p) => p.id === t.productId) : null
            return (
              <Card key={t.id}>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-surface-3 text-ink-muted">
                    <Shield className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[14px] font-semibold text-ink">{t.name}</h3>
                    <p className="truncate text-xs text-ink-muted">{t.description}</p>
                  </div>
                  {product ? (
                    <Pill tone="neutral">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: product.color }} />
                      {product.name}
                    </Pill>
                  ) : (
                    <Pill tone="brand">Cross-product</Pill>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                  <div className="flex -space-x-1.5">
                    {t.memberIds.slice(0, 6).map((id) => {
                      const a = agents.find((x) => x.id === id)
                      return a ? <Avatar key={id} name={a.name} color={a.avatarColor ?? '#6b7280'} size="sm" ring /> : null
                    })}
                  </div>
                  <span className="text-xs text-ink-subtle">{t.memberIds.length} members</span>
                  {can('team.manage') && (
                    <Button size="xs" className="ml-auto" onClick={() => setEditing(t)}>Manage</Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <TeamModal
        open={editing != null}
        team={editing === 'new' ? null : editing}
        agents={agents}
        onClose={() => setEditing(null)}
        onSaved={async (name) => {
          await load()
          setEditing(null)
          push({ tone: 'success', title: `${name} saved` })
        }}
      />
    </Page>
  )
}

function TeamModal({
  open, team, agents, onClose, onSaved,
}: {
  open: boolean
  team: Team | null
  agents: Agent[]
  onClose: () => void
  onSaved: (name: string) => void | Promise<void>
}) {
  const { products } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [productId, setProductId] = useState('')
  const [memberIds, setMemberIds] = useState<ID[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setName(team?.name ?? '')
    setDescription(team?.description ?? '')
    setProductId(team?.productId ? String(team.productId) : '')
    setMemberIds(team?.memberIds ?? [])
    setErrors({})
  }, [open, team])

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      const body = {
        name,
        description: description || undefined,
        productId: productId ? Number(productId) : null,
        memberIds,
      }
      if (team) await api.updateTeam(team.id, body)
      else await api.createTeam(body)
      await onSaved(name)
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={team ? `Manage ${team.name}` : 'Create team'}
      description="A team with no product spans all of them."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save team</Button>
        </>
      }
    >
      {errors._ && <p className="mb-3 rounded-ctl bg-danger-soft px-3 py-2 text-[13px] text-danger">{errors._}</p>}
      <div className="mb-3">
        <Label htmlFor="t-name">Name</Label>
        <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Charity ERP Support" className="h-8 text-[13px]" />
        <FormError errors={errors} field="name" />
      </div>
      <div className="mb-3">
        <Label htmlFor="t-desc" hint="Optional">Description</Label>
        <Textarea id="t-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="text-[13px]" />
      </div>
      <div className="mb-3">
        <Label htmlFor="t-product">Product</Label>
        <Select id="t-product" value={productId} onChange={(e) => setProductId(e.target.value)} className="h-8 text-[13px]">
          <option value="">All products (cross-product team)</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label hint={`${memberIds.length} selected`}>Members</Label>
        <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-ctl border border-line p-1">
          {agents
            .filter((a) => a.isActive)
            .map((a) => {
              const on = memberIds.includes(a.id)
              return (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1 hover:bg-surface-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setMemberIds((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))}
                    className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                  />
                  <Avatar name={a.name} color={a.avatarColor ?? '#6b7280'} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.name}</span>
                  <span className="truncate text-2xs text-ink-subtle">{a.email}</span>
                </label>
              )
            })}
        </div>
      </div>
    </Modal>
  )
}

// ─── Roles & permissions ────────────────────────────────────────────────────

export function Roles() {
  const { can } = useAuth()
  const { push } = useToast()
  const [data, setData] = useState<api.RolesPayload | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = () =>
    api.loadRoles().then((payload) => {
      setData(payload)
      setSelected((cur) => {
        const next = cur ?? payload.roles[0]?.code ?? null
        setDraft(new Set(payload.roles.find((r) => r.code === next)?.permissionCodes ?? []))
        return next
      })
    })

  useEffect(() => {
    void load()
  }, [])

  const choose = (code: string) => {
    setSelected(code)
    setDraft(new Set(data?.roles.find((r) => r.code === code)?.permissionCodes ?? []))
    // On a narrow screen the panel sits below the list, so a click would
    // otherwise change something off-screen with no visible feedback.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => scrollIntoView(panelRef.current, 'start'))
    }
  }

  if (!data) {
    return (
      <Page>
        <PageHeader title="Roles & Permissions" />
        <Skeleton className="h-96" />
      </Page>
    )
  }

  const role = data.roles.find((r) => r.code === selected) ?? data.roles[0]
  const saved = new Set(role?.permissionCodes ?? [])
  const dirty = draft.size !== saved.size || [...draft].some((p) => !saved.has(p))
  const editable = can('role.manage')

  const toggle = (code: string) => {
    if (!editable) return
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const save = async () => {
    if (!role) return
    setSaving(true)
    try {
      await api.updateRolePermissions(role.code, [...draft])
      await load()
      push({ tone: 'success', title: `${role.name} updated`, detail: `${draft.size} permissions granted.` })
    } catch (err) {
      push({ tone: 'error', title: 'Could not save', detail: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  const addRole = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      // Created with no permissions: an empty role grants nothing, so a
      // mistyped name can never hand out access by accident. Tick the
      // permissions deliberately, then save.
      const role = await api.createRole({ name, permissionCodes: [] })
      setNewName('')
      setCreating(false)
      await load()
      choose(role.code)
      push({ tone: 'success', title: `${role.name} created`, detail: 'Now choose its permissions and save.' })
    } catch (err) {
      push({ tone: 'error', title: 'Could not create the role', detail: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const removeRole = async (r: { code: string; name: string }) => {
    if (!window.confirm(`Delete the "${r.name}" role? This cannot be undone.`)) return
    setBusy(true)
    try {
      await api.deleteRole(r.code)
      setSelected(null)
      await load()
      push({ tone: 'success', title: `${r.name} deleted` })
    } catch (err) {
      // The API refuses while agents still hold the role, and says how many.
      push({ tone: 'error', title: 'Could not delete the role', detail: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const groups = [...new Set(data.permissions.map((p) => p.group))].map((group) => ({
    group,
    items: data.permissions.filter((p) => p.group === group),
  }))

  return (
    <Page>
      <PageHeader
        title="Roles & Permissions"
        description="Permissions are rows in the database, not hardcoded checks. The backend evaluates the same codes the UI uses, so a hidden button and a rejected request always agree."
      />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card padded={false}>
          <div className="p-2">
            {data.roles.map((r) => (
              <div key={r.code} className="group/role relative">
                <button
                  onClick={() => choose(r.code)}
                  className={cn(
                    'w-full rounded-ctl px-2.5 py-2 text-left transition-colors',
                    role?.code === r.code ? 'bg-brand-soft' : 'hover:bg-surface-3',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={cn('text-[13px] font-medium', role?.code === r.code ? 'text-brand' : 'text-ink')}>
                      {r.name}
                    </span>
                    {r.isSystem && (
                      <span title="Built in — its permissions can be edited, but it cannot be deleted"
                            className="rounded bg-surface-3 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                        built in
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block pr-6 text-xs leading-snug text-ink-subtle">{r.description}</span>
                </button>
                {editable && !r.isSystem && (
                  <button
                    onClick={() => void removeRole(r)}
                    disabled={busy}
                    title={`Delete the ${r.name} role`}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-ink-subtle opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger focus:opacity-100 group-hover/role:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {editable && (
            <div className="border-t border-line p-2">
              {creating ? (
                <div className="space-y-2">
                  <Input
                    autoFocus
                    value={newName}
                    placeholder="e.g. Support Manager"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addRole()
                      if (e.key === 'Escape') { setCreating(false); setNewName('') }
                    }}
                  />
                  <div className="flex gap-2">
                    <Button size="xs" variant="primary" loading={busy} disabled={!newName.trim()} onClick={() => void addRole()}>
                      Create
                    </Button>
                    <Button size="xs" onClick={() => { setCreating(false); setNewName('') }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button size="xs" className="w-full" onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5" /> New role
                </Button>
              )}
            </div>
          )}
        </Card>

        <Card ref={panelRef}>
          <SectionHeader
            title={role?.name ?? 'Role'}
            description={`${draft.size} of ${data.permissions.length} permissions granted${dirty ? ' · unsaved changes' : ''}`}
            action={
              editable ? (
                <div className="flex gap-2">
                  {dirty && (
                    <Button size="xs" onClick={() => setDraft(new Set(saved))} disabled={saving}>Reset</Button>
                  )}
                  <Button size="xs" variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
                    Save changes
                  </Button>
                </div>
              ) : undefined
            }
          />
          <div className="mt-4 space-y-4">
            {groups.map((g) => (
              <div key={g.group}>
                <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">{g.group}</p>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {g.items.map((item) => {
                    const on = draft.has(item.code)
                    return (
                      <button
                        key={item.code}
                        onClick={() => toggle(item.code)}
                        disabled={!editable}
                        title={item.description ?? undefined}
                        className={cn(
                          'flex items-center gap-2 rounded-ctl py-1 pr-1 text-left transition-colors',
                          editable ? 'hover:bg-surface-3' : 'cursor-default',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded',
                            on ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-subtle',
                          )}
                        >
                          {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        </span>
                        <span className={cn('min-w-0 flex-1 truncate text-[13px]', on ? 'text-ink' : 'text-ink-subtle')}>
                          {item.label}
                        </span>
                        <code className="shrink-0 font-mono text-2xs text-ink-subtle">{item.code}</code>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  )
}
