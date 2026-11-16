import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Mail, Plug, Plus, ShieldCheck, XCircle, Zap } from 'lucide-react'
import type { EmailProvider } from '@/data/types'
import * as api from '@/data/api'
import { PROVIDER_CATALOG, catalogFor } from '@/data/providerCatalog'
import { Page, PageHeader } from '@/components/ui/PageHeader'
import { Card, SectionHeader, Skeleton } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Label, Select, Toggle, Help } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'

export function EmailProviders() {
  const [providers, setProviders] = useState<EmailProvider[] | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [newType, setNewType] = useState<EmailProvider['type']>('mailpit')
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { push } = useToast()

  const field = (key: string) => ({
    value: form[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  })

  const openAdd = () => {
    setForm({})
    setFormError(null)
    setAdding(true)
  }

  const saveProvider = async () => {
    setSaving(true)
    setFormError(null)
    try {
      // Credentials are whatever the descriptor asked for — the UI never needs
      // to know what a given vendor calls its key.
      const credentials: Record<string, string> = {}
      for (const f of catalogFor(newType).fields) {
        if (form[f.key]) credentials[f.key] = form[f.key] as string
      }
      await api.createProvider({
        type: newType,
        name: form.name || `${catalogFor(newType).name} provider`,
        senderName: form.senderName || undefined,
        senderEmail: form.senderEmail || undefined,
        credentials: Object.keys(credentials).length ? credentials : undefined,
      })
      await refresh()
      setAdding(false)
      push({ tone: 'success', title: 'Provider added' })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the provider')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    api.listEmailProviders().then((p) => setProviders([...p]))
  }, [])

  const refresh = () => api.listEmailProviders().then((p) => setProviders([...p]))

  const test = async (p: EmailProvider) => {
    setTesting(p.id)
    const res = await api.testProvider(p.id)
    await refresh()
    setTesting(null)
    push({ tone: res.ok ? 'success' : 'error', title: res.ok ? `${p.name} is reachable` : `${p.name} failed`, detail: res.detail })
  }

  const spec = catalogFor(newType)

  return (
    <Page>
      <PageHeader
        title="Email Providers"
        description="Vendors are configuration, not code. Each product can use its own provider; anything unset falls back to the global default."
        action={<Button variant="primary" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add provider</Button>}
      />

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-info/25 bg-info-soft p-3.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div className="text-[13px] leading-relaxed text-ink">
          <p className="font-medium">Credentials never reach this screen.</p>
          <p className="mt-0.5 text-ink-muted">
            Keys are encrypted with AES-256-GCM and decrypted only at send time. The API returns a masked
            value, so a key cannot leak into a response by accident.
          </p>
        </div>
      </div>

      {!providers ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const catalog = catalogFor(p.type)
            const linked = p.productIds.map((id) => api.productById(id))
            return (
              <Card key={p.id} className={cn(!p.isEnabled && 'opacity-70')}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-muted">
                    <Mail className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-ink">{p.name}</h3>
                      {p.isGlobalDefault && <Pill tone="brand"><Zap className="h-3 w-3" /> Global default</Pill>}
                      {p.source === 'bootstrap' && <Pill tone="neutral">From secrets</Pill>}
                      {!p.isEnabled && <Pill tone="neutral">Disabled</Pill>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">{catalog.blurb}</p>

                    <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      <div className="flex items-center gap-2 text-[13px]">
                        <dt className="w-[76px] shrink-0 text-xs text-ink-subtle">Sender</dt>
                        <dd className="min-w-0 truncate text-ink">{p.senderName} &lt;{p.senderEmail}&gt;</dd>
                      </div>
                      {Object.entries(p.maskedCredentials).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 text-[13px]">
                          {/* Label comes from the provider descriptor, so it reads the way
                              the vendor names it rather than a de-camel-cased key. */}
                          <dt className="w-[76px] shrink-0 text-xs text-ink-subtle">
                            {catalog.fields.find((f) => f.key === k)?.label ?? k}
                          </dt>
                          <dd className="min-w-0 truncate font-mono text-xs text-ink-muted">{v}</dd>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 text-[13px]">
                        <dt className="w-[76px] shrink-0 text-xs text-ink-subtle">Products</dt>
                        <dd className="flex min-w-0 flex-wrap gap-1">
                          {linked.length ? linked.map((pr) => (
                            <span key={pr.id} className="inline-flex items-center gap-1 text-xs text-ink">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: pr.color }} />
                              {pr.name}
                            </span>
                          )) : <span className="text-xs text-ink-subtle">Fallback only</span>}
                        </dd>
                      </div>
                      <div className="flex items-center gap-2 text-[13px]">
                        <dt className="w-[76px] shrink-0 text-xs text-ink-subtle">Last test</dt>
                        <dd className="flex items-center gap-1.5">
                          {p.lastTestOk == null ? (
                            <span className="text-xs text-ink-subtle">Never</span>
                          ) : p.lastTestOk ? (
                            <span className="inline-flex items-center gap-1 text-xs text-success">
                              <CheckCircle2 className="h-3 w-3" /> Passed {relativeTime(p.lastTestedAt!)} ago
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-danger">
                              <XCircle className="h-3 w-3" /> Failed {relativeTime(p.lastTestedAt!)} ago
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Toggle
                      checked={p.isEnabled}
                      label={`Enable ${p.name}`}
                      onChange={async (v) => {
                        try {
                          await api.updateProvider(p.id, { isEnabled: v })
                          await refresh()
                          push({ tone: 'success', title: v ? `${p.name} enabled` : `${p.name} disabled` })
                        } catch (err) {
                          push({
                            tone: 'error',
                            title: 'Could not change that',
                            detail: err instanceof Error ? err.message : undefined,
                          })
                        }
                      }}
                    />
                    <div className="flex gap-1.5">
                      <Button size="xs" loading={testing === p.id} onClick={() => void test(p)}>
                        <Plug className="h-3 w-3" /> Test
                      </Button>
                      {!p.isGlobalDefault && p.isEnabled && (
                        <Button
                          size="xs"
                          onClick={async () => {
                            try {
                              await api.makeProviderDefault(p.id)
                              await refresh()
                              push({ tone: 'success', title: `${p.name} is now the global default` })
                            } catch (err) {
                              push({
                                tone: 'error',
                                title: 'Could not change the default',
                                detail: err instanceof Error ? err.message : undefined,
                              })
                            }
                          }}
                        >
                          Make default
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="mt-4">
        <SectionHeader title="How a reply picks its provider" description="Resolution order at send time" />
        <ol className="mt-3 space-y-2">
          {[
            'Find the product the ticket belongs to.',
            'Use that product’s configured provider, if there is one.',
            'Otherwise use the global default provider.',
            'If neither exists, fail loudly with an admin-facing error — never drop the reply silently.',
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-[13px] text-ink-muted">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-ink">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </Card>

      {/* The form below is generated from the provider descriptor. */}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an email provider"
        description="Fields are generated from the provider definition — adding a new vendor needs no UI change."
        footer={
          <>
            <Button onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void saveProvider()}>Save provider</Button>
          </>
        }
      >
        {formError && (
          <p className="mb-3 rounded-ctl bg-danger-soft px-3 py-2 text-[13px] text-danger">{formError}</p>
        )}
        <div className="mb-4">
          <Label htmlFor="ptype">Vendor</Label>
          <Select id="ptype" value={newType} onChange={(e) => setNewType(e.target.value)}>
            {PROVIDER_CATALOG.map((c) => (
              <option key={c.type} value={c.type}>{c.name}</option>
            ))}
          </Select>
          <Help>{spec.docsLabel}</Help>
        </div>

        <div className="mb-4">
          <Label htmlFor="pname">Display name</Label>
          <Input id="pname" placeholder={`${spec.name} — Production`} {...field('name')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="sname">Sender name</Label>
            <Input id="sname" placeholder="Support" {...field('senderName')} />
          </div>
          <div>
            <Label htmlFor="semail">Sender email</Label>
            <Input id="semail" type="email" placeholder="support@yourdomain.com" {...field('senderEmail')} />
          </div>
        </div>

        <hr className="my-4 border-line" />

        <p className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
          <KeyRound className="h-3 w-3" /> Credentials
        </p>
        {spec.fields.map((f) => (
          <div key={f.key} className="mb-4">
            <Label htmlFor={f.key} hint={f.required ? 'Required' : 'Optional'}>{f.label}</Label>
            <Input id={f.key} type={f.type} placeholder={f.placeholder} {...field(f.key)} />
            {f.help && <Help>{f.help}</Help>}
          </div>
        ))}
      </Modal>
    </Page>
  )
}
