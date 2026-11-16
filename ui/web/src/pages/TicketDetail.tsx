import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  ArrowLeft, Building2, CheckCheck, ChevronDown, Clock, CornerUpLeft, EyeOff,
  Globe, Lock, Mail, Paperclip, Send, Tag as TagIcon, Ticket as TicketIcon,
  TriangleAlert, User,
} from 'lucide-react'
import type { ShellContext } from '@/components/layout/AppShell'
import type { Ticket, TicketMessage } from '@/data/types'
import * as api from '@/data/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/components/ui/Toast'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { Menu, MenuItem, MenuLabel } from '@/components/ui/Menu'
import { PriorityBadge, StatusBadge, TagChip, Pill } from '@/components/ui/Badge'
import { DataRow, EmptyState, Skeleton } from '@/components/ui/Feedback'
import { bytes, fullDate, messageTime, relativeTime } from '@/lib/format'
import { scrollIntoView, scrollToBottom } from '@/lib/scroll'
import { cn } from '@/lib/cn'

/**
 * Delivery status presentation.
 *
 * 'sent' means a provider accepted it; 'delivered' means the recipient's
 * server did. Only those two are green — rendering 'failed' or 'queued' as a
 * success tick would tell an agent their reply arrived when it has not.
 */
const DELIVERY_FAILED = new Set(['failed', 'bounced', 'complained'])

const DELIVERY_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  sent: 'success',
  delivered: 'success',
  queued: 'warning',
  failed: 'danger',
  bounced: 'danger',
  complained: 'danger',
}

const DELIVERY_LABEL: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  queued: 'Sending…',
  failed: 'Not sent',
  bounced: 'Bounced',
  complained: 'Marked as spam',
}

const DELIVERY_ICON: Record<string, React.ReactNode> = {
  sent: <CheckCheck className="h-3 w-3" />,
  delivered: <CheckCheck className="h-3 w-3" />,
  queued: <Clock className="h-3 w-3" />,
  failed: <TriangleAlert className="h-3 w-3" />,
  bounced: <TriangleAlert className="h-3 w-3" />,
  complained: <TriangleAlert className="h-3 w-3" />,
}


export function TicketDetail() {
  const { ticketId } = useParams()
  const { user, can } = useAuth()
  const ctx = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const { push } = useToast()

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<'reply' | 'note'>('reply')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const convoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user || !ticketId) return
    setTicket(null)
    setNotFound(false)
    setDraft('')
    setTab('reply')
    api
      .getTicket(Number(ticketId))
      .then(setTicket)
      .catch(() => setNotFound(true))
  }, [user, ticketId])

  useEffect(() => {
    scrollIntoView(endRef.current, 'end')
  }, [ticket?.messages.length])

  // Switching between Reply and Private note changes who will read what you
  // write, so glide the conversation to its latest message: you compose with
  // the thing you are answering actually in view.
  useEffect(() => {
    if (!ticket) return
    scrollToBottom(convoRef.current)
  }, [tab, ticket?.id])

  const timeline = useMemo(() => {
    if (!ticket) return []
    const items = [
      ...ticket.messages.map((m) => ({ kind: 'message' as const, at: m.createdAt, message: m })),
      ...ticket.activities
        .filter((a) => a.action !== 'created')
        .map((a) => ({ kind: 'activity' as const, at: a.createdAt, activity: a })),
    ]
    return items.sort((a, b) => +new Date(a.at) - +new Date(b.at))
  }, [ticket])

  if (notFound) {
    return (
      <EmptyState
        className="h-full"
        icon={<EyeOff className="h-5 w-5" />}
        title="Ticket not found"
        description="It may belong to a product you are not authorized for. The backend returns 404 rather than 403 so ticket ids cannot be probed across products."
        action={<Button size="sm" onClick={() => navigate('/inbox')}>Back to inbox</Button>}
      />
    )
  }

  if (!ticket) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  const customer = api.customerById(ticket.customerId)
  const product = api.productById(ticket.productId)
  const status = api.statusByCode(ticket.statusCode)
  const priority = api.priorityByCode(ticket.priorityCode)
  const assignee = api.agentById(ticket.assigneeId)
  const team = api.teamById(ticket.teamId)
  const overdue = api.isOverdue(ticket)

  const patch = async (p: Parameters<typeof api.updateTicket>[1], label: string) => {
    const updated = await api.updateTicket(ticket.id, p)
    setTicket({ ...updated })
    ctx.reload()
    push({ tone: 'success', title: label })
  }

  const send = async () => {
    if (!draft.trim()) return
    setSending(true)
    const html = draft
      .trim()
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('')
    try {
      const fresh = await api.sendReply(ticket.id, html, tab === 'note' ? 'private' : 'public')
      setTicket({ ...fresh })
      setDraft('')
      ctx.reload()
      push({
        tone: 'success',
        title: tab === 'note' ? 'Private note added' : 'Reply sent',
        detail: tab === 'note'
          ? 'Visible to your team only — the customer cannot see it.'
          : `Delivered to ${customer.emails[0]} via ${product.name}’s email provider.`,
      })
    } finally {
      setSending(false)
    }
  }

  // Taking a ticket and handing it to someone else are separate privileges.
  const canAssign = can('ticket.assign.self') || can('ticket.assign.others')
  const canReply = can('ticket.reply')
  const canNote = can('ticket.note')
  const readOnly = !canReply && !canNote

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ─── Header ───────────────────────────────────────────────────── */}
        <header className="shrink-0 border-b border-line bg-surface px-4 py-3">
          <div className="mx-auto max-w-3xl">
          <div className="flex items-start gap-3">
            <Link to="/inbox" className="mt-0.5 md:hidden">
              <IconButton label="Back"><ArrowLeft className="h-4 w-4" /></IconButton>
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold leading-snug text-ink">{ticket.subject}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-subtle">
                <span className="inline-flex items-center gap-1 font-medium">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: product.color }} />
                  {product.name}
                </span>
                <span>·</span>
                <span className="font-mono">{ticket.number}</span>
                <span>·</span>
                <span>opened {relativeTime(ticket.createdAt)} ago</span>
                {overdue && (
                  <Pill tone="danger"><Clock className="h-3 w-3" /> First reply overdue</Pill>
                )}
              </div>
            </div>
          </div>

          {/* Quick controls — each gated on the matching permission */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Menu
              trigger={() => (
                <button disabled={!can('ticket.status.change')} className="disabled:pointer-events-none disabled:opacity-60">
                  <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 hover:bg-surface-2">
                    <StatusBadge status={status} />
                    <ChevronDown className="h-3 w-3 text-ink-subtle" />
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Status</MenuLabel>
                  {api.statuses.map((s) => (
                    <MenuItem key={s.code} selected={s.code === ticket.statusCode}
                      onClick={() => { void patch({ statusCode: s.code }, `Status set to ${s.name}`); close() }}>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>

            <Menu
              trigger={() => (
                <button disabled={!can('ticket.priority.change')} className="disabled:pointer-events-none disabled:opacity-60">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-[5px] hover:bg-surface-2">
                    <PriorityBadge priority={priority} />
                    <ChevronDown className="h-3 w-3 text-ink-subtle" />
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Priority</MenuLabel>
                  {api.priorities.map((p) => (
                    <MenuItem key={p.code} selected={p.code === ticket.priorityCode}
                      onClick={() => { void patch({ priorityCode: p.code }, `Priority set to ${p.name}`); close() }}>
                      {p.name}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>

            <Menu
              width="w-60"
              trigger={() => (
                <button disabled={!canAssign} className="disabled:pointer-events-none disabled:opacity-60">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-[5px] text-xs hover:bg-surface-2">
                    {assignee ? (
                      <>
                        <Avatar name={assignee.name} color={assignee.avatarColor} size="xs" />
                        <span className="text-ink">{assignee.name}</span>
                      </>
                    ) : (
                      <span className="text-ink-muted">Unassigned</span>
                    )}
                    <ChevronDown className="h-3 w-3 text-ink-subtle" />
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Assign to</MenuLabel>
                  <MenuItem selected={ticket.assigneeId == null}
                    onClick={() => { void patch({ assigneeId: null }, 'Ticket unassigned'); close() }}>
                    Unassigned
                  </MenuItem>
                  {api.assignableAgents(ticket.productId).map((a) => (
                    <MenuItem key={a.id} selected={a.id === ticket.assigneeId}
                      icon={<Avatar name={a.name} color={a.avatarColor} size="xs" />}
                      onClick={() => { void patch({ assigneeId: a.id }, `Assigned to ${a.name}`); close() }}>
                      {a.name}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>

            {ticket.tagIds.map((id) => {
              const tag = api.tagById(id)
              return tag ? <TagChip key={id} tag={tag} /> : null
            })}
          </div>
          </div>
        </header>

        {/* ─── Conversation ─────────────────────────────────────────────── */}
        <div ref={convoRef} className="scroll-smooth-area min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-3xl space-y-3">
            {timeline.map((item) =>
              item.kind === 'message' ? (
                <MessageBubble key={`m${item.message.id}`} message={item.message} />
              ) : (
                <ActivityLine key={`a${item.activity.id}`}
                  text={activityText(item.activity.action, item.activity.oldValue, item.activity.newValue)}
                  actor={api.agentById(item.activity.actorId)?.name ?? 'System'}
                  at={item.at} />
              ),
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* ─── Composer ─────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-line bg-surface px-4 py-3">
          <div className="mx-auto max-w-3xl">
            {readOnly ? (
              <p className="flex items-center justify-center gap-2 rounded-lg bg-surface-3 py-3 text-[13px] text-ink-muted">
                <Lock className="h-3.5 w-3.5" />
                Your role has read-only access to tickets.
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-1">
                  {canReply && (
                    <ComposerTab active={tab === 'reply'} onClick={() => setTab('reply')}
                      icon={<CornerUpLeft className="h-3.5 w-3.5" />} label="Reply" />
                  )}
                  {canNote && (
                    <ComposerTab active={tab === 'note'} onClick={() => setTab('note')} tone="note"
                      icon={<Lock className="h-3.5 w-3.5" />} label="Private note" />
                  )}
                </div>

                <div
                  className={cn(
                    'rounded-card border transition-colors',
                    tab === 'note'
                      ? 'border-warning/40 bg-warning-soft'
                      : 'border-line bg-surface focus-within:border-brand',
                  )}
                >
                  {/* The single most important affordance in the app: it must be
                      impossible to mistake an internal note for a customer reply. */}
                  <div className={cn(
                    'flex items-center gap-2 border-b px-3 py-1.5 text-2xs font-semibold',
                    tab === 'note' ? 'border-warning/30 text-warning' : 'border-line text-ink-subtle',
                  )}>
                    {tab === 'note' ? (
                      <><Lock className="h-3 w-3" /> PRIVATE NOTE — the customer will not see this</>
                    ) : (
                      <><Globe className="h-3 w-3" /> To {customer.name} &lt;{customer.emails[0]}&gt; from {product.supportEmail}</>
                    )}
                  </div>

                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send()
                    }}
                    rows={3}
                    placeholder={tab === 'note' ? 'Add context for your team…' : `Reply to ${customer.name.split(' ')[0]}…`}
                    className="w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none"
                  />

                  <div className="flex items-center gap-2 px-3 pb-2.5">
                    <IconButton label="Attach a file" className="h-7 w-7"><Paperclip className="h-3.5 w-3.5" /></IconButton>
                    <span className="text-2xs text-ink-subtle">
                      <kbd className="rounded border border-line bg-surface px-1 font-mono">⌘</kbd>
                      <kbd className="ml-0.5 rounded border border-line bg-surface px-1 font-mono">↵</kbd> to send
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {tab === 'reply' && (
                        <Button size="sm" variant="ghost"
                          onClick={() => void patch({ statusCode: 'resolved' }, 'Ticket resolved')}
                          disabled={!can('ticket.status.change')}>
                          <CheckCheck className="h-3.5 w-3.5" /> Resolve
                        </Button>
                      )}
                      <Button size="sm" variant={tab === 'note' ? 'secondary' : 'primary'}
                        loading={sending} disabled={!draft.trim()} onClick={() => void send()}>
                        {tab === 'note' ? <Lock className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                        {tab === 'note' ? 'Add note' : 'Send reply'}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Properties rail ──────────────────────────────────────────────── */}
      <aside className="hidden w-[272px] shrink-0 overflow-y-auto border-l border-line bg-surface-2 p-4 2xl:block">
        <section>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Customer</h3>
          <Link to={`/customers/${customer.id}`} className="flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-surface-3">
            <Avatar name={customer.name} color={product.color} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink">{customer.name}</span>
              <span className="block truncate text-xs text-ink-subtle">{customer.emails[0]}</span>
            </span>
          </Link>
          <div className="mt-1 space-y-0 px-1.5">
            {customer.company && <DataRow label="Company"><span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3 text-ink-subtle" />{customer.company}</span></DataRow>}
            {customer.phone && <DataRow label="Phone">{customer.phone}</DataRow>}
            {customer.timezone && <DataRow label="Timezone">{customer.timezone}</DataRow>}
          </div>
        </section>

        <hr className="my-4 border-line" />

        <section>
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Properties</h3>
          <DataRow label="Status"><StatusBadge status={status} /></DataRow>
          <DataRow label="Priority"><PriorityBadge priority={priority} /></DataRow>
          <DataRow label="Assignee">{assignee?.name ?? <span className="text-ink-subtle">Unassigned</span>}</DataRow>
          <DataRow label="Team">{team?.name ?? <span className="text-ink-subtle">—</span>}</DataRow>
          <DataRow label="Source"><span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-ink-subtle" />{ticket.source}</span></DataRow>
          <DataRow label="Created">{relativeTime(ticket.createdAt)} ago</DataRow>
        </section>

        <hr className="my-4 border-line" />

        <section>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">First response</h3>
          {ticket.firstRespondedAt ? (
            <p className="flex items-center gap-1.5 text-[13px] text-success">
              <CheckCheck className="h-3.5 w-3.5" /> Replied {relativeTime(ticket.firstRespondedAt)} ago
            </p>
          ) : overdue ? (
            <p className="flex items-center gap-1.5 text-[13px] text-danger">
              <Clock className="h-3.5 w-3.5" /> Overdue since {relativeTime(ticket.frDueAt!)} ago
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[13px] text-ink-muted">
              <Clock className="h-3.5 w-3.5" /> Due {ticket.frDueAt ? relativeTime(ticket.frDueAt) : '—'}
            </p>
          )}
        </section>

        <hr className="my-4 border-line" />

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
            <TicketIcon className="h-3 w-3" /> Previous tickets
          </h3>
          <PreviousTickets ticket={ticket} />
        </section>

        {ticket.tagIds.length > 0 && (
          <>
            <hr className="my-4 border-line" />
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                <TagIcon className="h-3 w-3" /> Tags
              </h3>
              <div className="flex flex-wrap gap-1">
                {ticket.tagIds.map((id) => {
                  const tag = api.tagById(id)
                  return tag ? <TagChip key={id} tag={tag} /> : null
                })}
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  )
}

function ComposerTab({
  active, onClick, icon, label, tone,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  tone?: 'note'
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? tone === 'note'
            ? 'bg-warning-soft text-warning'
            : 'bg-brand-soft text-brand'
          : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function MessageBubble({ message }: { message: TicketMessage }) {
  const isNote = message.visibility === 'private'
  const isInbound = message.type === 'inbound_email'
  const author = api.agentById(message.authorId)

  return (
    <article
      className={cn(
        'rounded-card border',
        isNote
          ? 'border-warning/35 bg-warning-soft'
          : isInbound
            ? 'border-line bg-surface'
            : 'border-brand/20 bg-brand-soft/40',
      )}
    >
      <header className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
        <Avatar name={message.fromName} color={author?.avatarColor ?? '#6b7280'} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-ink">{message.fromName}</span>
          <span className="block truncate text-2xs text-ink-subtle">
            {isNote ? 'Internal note' : isInbound ? message.fromAddress : `to ${message.to.join(', ')}`}
          </span>
        </span>

        <span className="ml-auto flex items-center gap-2">
          {isNote && (
            <Pill tone="warning"><Lock className="h-3 w-3" /> Private</Pill>
          )}
          {!isNote && !isInbound && message.deliveryStatus && (
            <Pill tone={DELIVERY_TONE[message.deliveryStatus] ?? 'neutral'} className={DELIVERY_FAILED.has(message.deliveryStatus) ? 'cursor-help' : undefined}>
              {DELIVERY_ICON[message.deliveryStatus]} {DELIVERY_LABEL[message.deliveryStatus] ?? message.deliveryStatus}
            </Pill>
          )}
          <time className="shrink-0 text-2xs text-ink-subtle" title={fullDate(message.createdAt)}>
            {messageTime(message.createdAt)}
          </time>
        </span>
      </header>

      {/* A failed send is the one thing an agent must not miss: without this
          they believe the customer received a reply that never left. */}
      {!isNote && !isInbound && message.deliveryStatus && DELIVERY_FAILED.has(message.deliveryStatus) && (
        <p className="mb-2 flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-2xs leading-relaxed text-danger">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <strong className="font-semibold">The customer did not receive this.</strong>{' '}
            {message.deliveryDetail ?? 'No reason was recorded.'}
          </span>
        </p>
      )}

      {isNote && (
        <p className="mt-2 px-3.5 text-2xs font-semibold uppercase tracking-wide text-warning">
          Not visible to the customer
        </p>
      )}

      <div
        className="email-body px-3.5 py-3"
        // Sanitized server-side against an allowlist before it is ever stored.
        dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
      />

      {message.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line/60 px-3.5 py-2.5">
          {message.attachments.map((a) => (
            <button
              key={a.id}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-line-strong"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <span className="min-w-0">
                <span className="block max-w-[180px] truncate text-xs font-medium text-ink">{a.filename}</span>
                <span className="block text-2xs text-ink-subtle">{bytes(a.sizeBytes)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

function ActivityLine({ text, actor, at }: { text: string; actor: string; at: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-ink-subtle">
      <span className="h-px flex-1 bg-line" />
      <span className="shrink-0">
        <span className="font-medium text-ink-muted">{actor}</span> {text} · {relativeTime(at)} ago
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

function activityText(action: string, oldValue: string | null, newValue: string | null): string {
  switch (action) {
    case 'assigned': return `assigned this to ${newValue}`
    case 'status_changed': return `changed status from ${oldValue} to ${newValue}`
    case 'priority_changed': return `changed priority from ${oldValue} to ${newValue}`
    case 'reopened': return 'reopened this ticket'
    case 'merged': return 'merged this ticket'
    case 'tagged': return `tagged this ${newValue}`
    default: return 'updated this ticket'
  }
}

function PreviousTickets({ ticket }: { ticket: Ticket }) {
  const { user } = useAuth()
  const [rows, setRows] = useState<Ticket[] | null>(null)

  useEffect(() => {
    if (!user || ticket.customerId < 0) return
    api
      .ticketsForCustomer(ticket.customerId)
      .then((r) => setRows(r.filter((t) => t.id !== ticket.id)))
      .catch(() => setRows([]))
  }, [user, ticket.customerId, ticket.id])

  if (!rows) return <Skeleton className="h-12" />
  if (!rows.length) return <p className="text-xs text-ink-subtle">No other tickets from this customer.</p>

  return (
    <div className="space-y-1">
      {rows.slice(0, 4).map((t) => (
        <Link key={t.id} to={`/inbox/${t.id}`} className="block rounded-lg p-1.5 transition-colors hover:bg-surface-3">
          <span className="block truncate text-xs font-medium text-ink">{t.subject}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <StatusBadge status={api.statusByCode(t.statusCode)} />
            <span className="text-2xs text-ink-subtle">{relativeTime(t.lastActivityAt)}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
