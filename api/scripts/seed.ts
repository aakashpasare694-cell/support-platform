import 'dotenv/config'
import Database from 'better-sqlite3'
import { resolve } from 'node:path'
import { buildConfig } from '../src/config/index.ts'
import { hashPassword } from '../src/lib/crypto.ts'
import { createNodeDb, closeDb } from '../src/db/sqlite.ts'
import { setDefaultDb } from '../src/db/index.ts'
import { bootstrapEmailProvider } from '../src/modules/email/providers/bootstrap.ts'

/**
 * Seeds the vocabulary, roles and a first administrator.
 *
 * Idempotent: every insert is an upsert on a natural key, so running it twice
 * changes nothing. That matters because this also runs on a fresh deploy.
 */

const PERMISSIONS: [code: string, group: string, label: string, description: string | null][] = [
  // ── Ticket visibility: a SCOPE, resolved per product, broadest wins ──
  ['ticket.view.assigned', 'Ticket access', 'View tickets assigned to them', 'Only tickets where they are the assignee'],
  ['ticket.view.team', 'Ticket access', 'View their teams’ tickets', 'Tickets assigned to them or to a team they belong to'],
  ['ticket.view.all', 'Ticket access', 'View all tickets', 'Every ticket on the product'],

  // ── Working a ticket ──
  ['ticket.create', 'Tickets', 'Create tickets', 'Raise a ticket on a customer’s behalf'],
  ['ticket.reply', 'Tickets', 'Reply to customers', 'Send a public reply the customer receives'],
  ['ticket.note', 'Tickets', 'Add private notes', 'Internal notes the customer never sees'],
  ['ticket.assign.self', 'Tickets', 'Take tickets', 'Assign a ticket to themselves'],
  ['ticket.assign.others', 'Tickets', 'Assign to other agents', 'Hand a ticket to someone else or to a team'],
  ['ticket.status.change', 'Tickets', 'Change status', null],
  ['ticket.priority.change', 'Tickets', 'Change priority', null],
  ['ticket.tag', 'Tickets', 'Add and remove tags', null],
  ['ticket.reopen', 'Tickets', 'Reopen resolved tickets', null],
  ['ticket.merge', 'Tickets', 'Merge tickets', null],
  ['ticket.spam', 'Tickets', 'Mark as spam', null],
  ['ticket.delete', 'Tickets', 'Delete tickets', 'Permanent; normally reserved for admins'],
  ['ticket.export', 'Tickets', 'Export tickets', 'Download ticket data as a file'],

  // ── Attachments ──
  ['attachment.download', 'Attachments', 'Download attachments', null],
  ['attachment.upload', 'Attachments', 'Attach files to replies', null],
  ['attachment.delete', 'Attachments', 'Delete attachments', null],

  // ── Customers ──
  ['customer.view', 'Customers', 'View customers', null],
  ['customer.create', 'Customers', 'Create customers', null],
  ['customer.manage', 'Customers', 'Edit customers', null],
  ['customer.merge', 'Customers', 'Merge duplicate customers', null],
  ['customer.delete', 'Customers', 'Delete customers', null],

  // ── Administration ──
  ['product.view', 'Administration', 'View product settings', null],
  ['product.manage', 'Administration', 'Add and edit products', null],
  ['agent.view', 'Administration', 'View agents', null],
  ['agent.manage', 'Administration', 'Invite and edit agents', null],
  ['agent.deactivate', 'Administration', 'Deactivate agents', null],
  ['team.view', 'Administration', 'View teams', null],
  ['team.manage', 'Administration', 'Create and edit teams', null],
  ['role.view', 'Administration', 'View roles and permissions', null],
  ['role.manage', 'Administration', 'Edit roles and permissions', 'Can widen anyone’s access, including their own'],

  // ── Settings ──
  ['settings.email_providers.view', 'Settings', 'View email providers', 'Credentials are always masked'],
  ['settings.email_providers.manage', 'Settings', 'Configure email providers', null],
  ['settings.inbound.manage', 'Settings', 'Configure inbound addresses', 'Which address routes to which product'],
  ['settings.general.manage', 'Settings', 'Change general settings', null],
  ['tag.manage', 'Settings', 'Manage the tag list', null],
  ['automation.view', 'Settings', 'View automation rules', null],
  ['automation.manage', 'Settings', 'Edit automation rules', null],
  ['sla.view', 'Settings', 'View SLA policies', null],
  ['sla.manage', 'Settings', 'Edit SLA policies and business hours', null],
  ['canned.view', 'Settings', 'Use canned responses', null],
  ['canned.manage', 'Settings', 'Manage their own canned responses', null],
  ['canned.manage_shared', 'Settings', 'Manage shared canned responses', null],

  // ── Insights ──
  ['report.view.own', 'Insights', 'View their own statistics', 'Their numbers only, not other agents’'],
  ['report.view', 'Insights', 'View all reports', null],
  ['report.export', 'Insights', 'Export reports', null],
  ['audit.view', 'Insights', 'View the audit log', null],
]

const ALL = PERMISSIONS.map(([c]) => c)

/** Read-only: can see everything they are scoped to, change nothing. */
const READ_ONLY = [
  'ticket.view.all', 'attachment.download',
  'customer.view', 'product.view', 'agent.view', 'team.view',
  'canned.view', 'automation.view', 'sla.view',
  'settings.email_providers.view', 'report.view.own',
]

const ROLES: [code: string, name: string, description: string, permissions: string[]][] = [
  // Only two roles ship by default. They exist so there is always a way in —
  // Super Admin to hold everything, Admin to run the place day to day.
  //
  // Every other role an organisation needs is theirs to create under
  // Admin -> Roles, because what a "Support Manager" may do is an
  // organisational decision, not something this product should presume.
  ['super_admin', 'Super Admin', 'Full access to every product and all settings', ALL],
  ['admin', 'Admin', 'Manage products, agents, teams and settings', ALL.filter((p) => p !== 'ticket.delete')],
]

// Semantic flags, not names: logic asks is_open / is_resolved / pauses_sla, so
// an admin can rename these or add their own without a code change.
const STATUSES: [code: string, name: string, color: string, open: number, resolved: number, pauses: number, def: number][] = [
  ['open', 'Open', '#2563eb', 1, 0, 0, 1],
  ['pending', 'Pending', '#b45309', 1, 0, 1, 0],
  ['in_progress', 'In Progress', '#7c3aed', 1, 0, 0, 0],
  ['resolved', 'Resolved', '#15803d', 0, 1, 0, 0],
  ['closed', 'Closed', '#6b7280', 0, 1, 0, 0],
]

const PRIORITIES: [code: string, name: string, color: string, weight: number, def: number][] = [
  ['low', 'Low', '#6b7280', 10, 0],
  ['medium', 'Medium', '#2563eb', 20, 1],
  ['high', 'High', '#ea580c', 30, 0],
  ['urgent', 'Urgent', '#dc2626', 40, 0],
]

const PRODUCTS: [code: string, name: string, slug: string, color: string, prefix: string, email: string][] = [
  ['charity_erp', 'Charity ERP', 'charity-erp', '#4f46e5', 'ERP', 'erp@incomingmail.charityerp.com'],
  ['pranic_healing', 'Pranic Healing', 'pranic-healing', '#0d9488', 'PH', 'pranic@incomingmail.charityerp.com'],
  ['crm', 'CRM', 'crm', '#db2777', 'CRM', 'crm@incomingmail.charityerp.com'],
]

const TAGS = [
  ['billing', '#b45309'], ['bug', '#dc2626'], ['how-to', '#2563eb'], ['refund', '#be185d'],
  ['integration', '#7c3aed'], ['onboarding', '#0d9488'], ['escalation', '#dc2626'],
  ['feature-request', '#0369a1'],
]

async function main() {
  const config = buildConfig(process.env as Record<string, string | undefined>)
  const file = resolve(config.db.file)
  const db = new Database(file)
  db.pragma('foreign_keys = ON')

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@support.local').toLowerCase()
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026'

  console.log('Seeding permissions…')
  const upsertPermission = db.prepare(`
    INSERT INTO sp_permissions (code, permission_group, label, description, sort_order)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      permission_group = excluded.permission_group,
      label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order
  `)
  db.transaction(() => {
    PERMISSIONS.forEach(([code, group, label, description], i) =>
      upsertPermission.run(code, group, label, description, i),
    )
  })()

  // Drop codes that left the catalogue, so a rename does not leave a dead
  // permission granted to somebody.
  db.prepare(
    `DELETE FROM sp_permissions WHERE code NOT IN (${PERMISSIONS.map(() => '?').join(',')})`,
  ).run(...PERMISSIONS.map(([c]) => c))

  console.log('Seeding roles…')
  const upsertRole = db.prepare(`
    INSERT INTO sp_roles (code, name, description, sort_order, is_system)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name, description = excluded.description, sort_order = excluded.sort_order
  `)
  const roleId = db.prepare('SELECT id FROM sp_roles WHERE code = ?')
  const clearGrants = db.prepare('DELETE FROM sp_role_permissions WHERE role_id = ?')
  const grant = db.prepare(`
    INSERT OR IGNORE INTO sp_role_permissions (role_id, permission_id)
    SELECT ?, id FROM sp_permissions WHERE code = ?
  `)

  db.transaction(() => {
    ROLES.forEach(([code, name, description, permissions], i) => {
      upsertRole.run(code, name, description, i)
      const { id } = roleId.get(code) as { id: number }
      // Replace the grant set so an edited catalogue converges on re-seed.
      clearGrants.run(id)
      for (const perm of permissions) grant.run(id, perm)
    })
  })()

  console.log('Seeding statuses and priorities…')
  const upsertStatus = db.prepare(`
    INSERT INTO sp_ticket_statuses (code, name, color, sort_order, is_open, is_resolved, pauses_sla, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name, color = excluded.color, is_open = excluded.is_open,
      is_resolved = excluded.is_resolved, pauses_sla = excluded.pauses_sla,
      is_default = excluded.is_default, sort_order = excluded.sort_order
  `)
  const upsertPriority = db.prepare(`
    INSERT INTO sp_ticket_priorities (code, name, color, sort_order, weight, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name, color = excluded.color, weight = excluded.weight,
      is_default = excluded.is_default, sort_order = excluded.sort_order
  `)
  db.transaction(() => {
    STATUSES.forEach(([code, name, color, open, resolved, pauses, def], i) =>
      upsertStatus.run(code, name, color, i, open, resolved, pauses, def),
    )
    PRIORITIES.forEach(([code, name, color, weight, def], i) =>
      upsertPriority.run(code, name, color, i, weight, def),
    )
  })()

  console.log('Seeding products…')
  const upsertProduct = db.prepare(`
    INSERT INTO sp_products (code, name, slug, color, ticket_prefix, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name, color = excluded.color, ticket_prefix = excluded.ticket_prefix
  `)
  const productId = db.prepare('SELECT id FROM sp_products WHERE code = ?')
  const upsertInbound = db.prepare(`
    INSERT INTO sp_inbound_addresses (address, product_id, is_active) VALUES (?, ?, 1)
    ON CONFLICT(address) DO UPDATE SET product_id = excluded.product_id
  `)
  const upsertTeam = db.prepare(`
    INSERT OR IGNORE INTO sp_teams (product_id, name, description) VALUES (?, ?, ?)
  `)
  db.transaction(() => {
    for (const [code, name, slug, color, prefix, email] of PRODUCTS) {
      upsertProduct.run(code, name, slug, color, prefix)
      const { id } = productId.get(code) as { id: number }
      upsertInbound.run(email, id)
      upsertTeam.run(id, `${name} Support`, `Front line for ${name}`)
    }
  })()

  console.log('Seeding tags…')
  const upsertTag = db.prepare(`
    INSERT INTO sp_tags (product_id, name, color) VALUES (NULL, ?, ?)
    ON CONFLICT(product_id, name) DO UPDATE SET color = excluded.color
  `)
  db.transaction(() => {
    for (const [name, color] of TAGS) upsertTag.run(name, color)
  })()

  console.log('Seeding the first administrator…')
  const hash = await hashPassword(adminPassword)
  db.prepare(`
    INSERT INTO sp_users (email, name, password_hash, job_title, avatar_color, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash
  `).run(adminEmail, 'Support Administrator', hash, 'Head of Support', '#4f46e5')

  const { id: userId } = db.prepare('SELECT id FROM sp_users WHERE email = ?').get(adminEmail) as { id: number }

  // product_id NULL is the global grant — there is no separate is_admin flag.
  db.prepare(`
    INSERT OR IGNORE INTO sp_user_product_roles (user_id, product_id, role_id)
    SELECT ?, NULL, id FROM sp_roles WHERE code = 'super_admin'
  `).run(userId)

  db.close()

  // The bootstrap provider goes through the normal Kysely path so it is
  // encrypted and guarded exactly as an admin-created one would be.
  console.log('Bootstrapping the default email provider…')
  setDefaultDb(createNodeDb(config))
  const bootstrap = await bootstrapEmailProvider(config.defaultEmailProvider, config.credentialsMasterKey)
  console.log(`  ${bootstrap.reason}`)
  await closeDb()

  console.log('\nSeed complete.')
  console.log(`  Database: ${file}`)
  console.log(`  Sign in:  ${adminEmail}`)
  console.log(`  Password: ${adminPassword}${process.env.SEED_ADMIN_PASSWORD ? '' : '   <-- change this, or set SEED_ADMIN_PASSWORD'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
