import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

/**
 * Database types.
 *
 * Hand-written to match `migrations/`. Once a database exists,
 * `kysely-codegen` can regenerate this by introspection — migrations stay the
 * source of truth either way.
 *
 * Both pools run with `dateStrings: true`, so DATETIME columns arrive as
 * strings. That is deliberate: it stops Node and workerd disagreeing about
 * timezone coercion.
 */
type DateString = ColumnType<string, string | undefined, string>
type Bool = ColumnType<number, number | undefined, number>

export interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  password_hash: string | null
  avatar_color: string | null
  job_title: string | null
  timezone: ColumnType<string, string | undefined, string>
  is_active: Bool
  last_login_at: ColumnType<string | null, string | null | undefined, string | null>
  created_at: DateString
  updated_at: DateString
}

export interface RolesTable {
  id: Generated<number>
  code: string
  name: string
  description: string | null
  sort_order: ColumnType<number, number | undefined, number>
  is_system: Bool
  created_at: DateString
}

export interface PermissionsTable {
  id: Generated<number>
  code: string
  permission_group: string
  label: string
  description: string | null
  sort_order: ColumnType<number, number | undefined, number>
}

export interface RolePermissionsTable {
  role_id: number
  permission_id: number
}

export interface ProductsTable {
  id: Generated<number>
  code: string
  name: string
  slug: string
  description: string | null
  color: ColumnType<string, string | undefined, string>
  ticket_prefix: string
  is_active: Bool
  settings_json: ColumnType<unknown | null, string | null | undefined, string | null>
  created_at: DateString
  updated_at: DateString
}

export interface UserProductRolesTable {
  id: Generated<number>
  user_id: number
  /** NULL means every product — a global grant. */
  product_id: number | null
  role_id: number
  created_at: DateString
}

export interface TeamsTable {
  id: Generated<number>
  product_id: number | null
  name: string
  description: string | null
  is_active: Bool
  created_at: DateString
}

export interface TeamMembersTable {
  team_id: number
  user_id: number
}

export interface RefreshTokensTable {
  id: Generated<number>
  user_id: number
  token_hash: string
  expires_at: DateString
  revoked_at: ColumnType<string | null, string | null | undefined, string | null>
  user_agent: string | null
  ip: string | null
  created_at: DateString
}

export interface CustomersTable {
  id: Generated<number>
  name: string
  company: string | null
  phone: string | null
  timezone: string | null
  notes: string | null
  created_at: DateString
  updated_at: DateString
}

export interface CustomerEmailsTable {
  id: Generated<number>
  customer_id: number
  email: string
  is_primary: Bool
  created_at: DateString
}

export interface CustomerProductsTable {
  customer_id: number
  product_id: number
  first_seen_at: DateString
}

export interface TicketStatusesTable {
  id: Generated<number>
  code: string
  name: string
  color: ColumnType<string, string | undefined, string>
  sort_order: ColumnType<number, number | undefined, number>
  is_open: Bool
  is_resolved: Bool
  pauses_sla: Bool
  is_default: Bool
}

export interface TicketPrioritiesTable {
  id: Generated<number>
  code: string
  name: string
  color: ColumnType<string, string | undefined, string>
  sort_order: ColumnType<number, number | undefined, number>
  weight: ColumnType<number, number | undefined, number>
  is_default: Bool
}

export interface ProductCountersTable {
  product_id: number
  last_number: ColumnType<number, number | undefined, number>
}

export interface TicketsTable {
  id: Generated<number>
  ticket_number: string
  product_id: number
  customer_id: number | null
  subject: string
  status_id: number
  priority_id: number
  assignee_id: number | null
  team_id: number | null
  source: ColumnType<string, string | undefined, string>
  sla_policy_id: number | null
  fr_due_at: ColumnType<string | null, string | null | undefined, string | null>
  resolution_due_at: ColumnType<string | null, string | null | undefined, string | null>
  first_responded_at: ColumnType<string | null, string | null | undefined, string | null>
  resolved_at: ColumnType<string | null, string | null | undefined, string | null>
  closed_at: ColumnType<string | null, string | null | undefined, string | null>
  last_customer_reply_at: ColumnType<string | null, string | null | undefined, string | null>
  last_agent_reply_at: ColumnType<string | null, string | null | undefined, string | null>
  last_activity_at: DateString
  merged_into_ticket_id: number | null
  is_spam: Bool
  created_at: DateString
  updated_at: DateString
}

export interface TagsTable {
  id: Generated<number>
  product_id: number | null
  name: string
  color: ColumnType<string, string | undefined, string>
  created_at: DateString
}

export interface TicketTagsTable {
  ticket_id: number
  tag_id: number
}

export interface TicketMessagesTable {
  id: Generated<number>
  ticket_id: number
  message_type: string
  visibility: ColumnType<string, string | undefined, string>
  author_user_id: number | null
  from_name: string | null
  from_address: string | null
  to_json: ColumnType<unknown | null, string | null | undefined, string | null>
  cc_json: ColumnType<unknown | null, string | null | undefined, string | null>
  bcc_json: ColumnType<unknown | null, string | null | undefined, string | null>
  subject: string | null
  body_html: string | null
  body_html_sanitized: string | null
  body_text: string | null
  message_id: string | null
  in_reply_to: string | null
  message_references: string | null
  provider_id: number | null
  provider_message_id: string | null
  delivery_status: string | null
  delivery_detail: string | null
  raw_r2_key: string | null
  created_at: DateString
}

export interface TicketActivitiesTable {
  id: Generated<number>
  ticket_id: number
  actor_user_id: number | null
  action: string
  field: string | null
  old_value: string | null
  new_value: string | null
  created_at: DateString
}

export interface AttachmentsTable {
  id: Generated<number>
  message_id: number | null
  ticket_id: number
  product_id: number
  filename: string
  content_type: string
  size_bytes: number
  checksum_sha256: string | null
  r2_key: string
  is_inline: Bool
  content_id: string | null
  uploaded_by_id: number | null
  created_at: DateString
}

export interface EmailProvidersTable {
  id: Generated<number>
  type: string
  name: string
  credentials_encrypted: string | null
  config_json: ColumnType<unknown | null, string | null | undefined, string | null>
  is_enabled: Bool
  is_global_default: Bool
  source: ColumnType<string, string | undefined, string>
  sender_name: string | null
  sender_email: string | null
  last_tested_at: ColumnType<string | null, string | null | undefined, string | null>
  last_test_ok: ColumnType<number | null, number | null | undefined, number | null>
  last_test_detail: string | null
  created_at: DateString
  updated_at: DateString
}

export interface ProductEmailProvidersTable {
  product_id: number
  provider_id: number
  sender_name: string | null
  sender_email: string | null
  reply_to: string | null
  is_active: Bool
}

export interface SavedViewsTable {
  id: Generated<number>
  owner_user_id: number
  product_id: number | null
  name: string
  icon: string | null
  is_shared: Bool
  filters_json: ColumnType<unknown, string, string>
  sort_order: ColumnType<number, number | undefined, number>
  created_at: DateString
}

export interface AuditLogsTable {
  id: Generated<number>
  actor_user_id: number | null
  action: string
  entity_type: string
  entity_id: string | null
  diff_json: ColumnType<unknown | null, string | null | undefined, string | null>
  ip: string | null
  user_agent: string | null
  created_at: DateString
}

export interface SettingsTable {
  setting_key: string
  value_json: ColumnType<unknown, string, string>
  updated_at: DateString
}

export interface InboundAddressesTable {
  id: Generated<number>
  address: string
  product_id: number
  is_active: Bool
  created_at: DateString
}

export interface EmailIngestLogTable {
  id: Generated<number>
  source: string
  provider_event_id: string | null
  message_id: string | null
  dedupe_hash: string | null
  raw_r2_key: string | null
  status: ColumnType<string, string | undefined, string>
  ticket_id: number | null
  error: string | null
  attempts: ColumnType<number, number | undefined, number>
  created_at: DateString
}

export interface EmailDeliveryEventsTable {
  id: Generated<number>
  message_id: number | null
  provider_id: number | null
  provider_message_id: string | null
  event: string
  payload_json: ColumnType<unknown | null, string | null | undefined, string | null>
  occurred_at: DateString
  created_at: DateString
}

export interface JobsTable {
  id: Generated<number>
  job_name: string
  payload_json: ColumnType<unknown, string, string>
  run_after: DateString
  attempts: ColumnType<number, number | undefined, number>
  status: ColumnType<string, string | undefined, string>
  last_error: string | null
  created_at: DateString
  updated_at: DateString
}

export interface SchemaMigrationsTable {
  filename: string
  applied_at: DateString
}

export interface DB {
  sp_users: UsersTable
  sp_roles: RolesTable
  sp_permissions: PermissionsTable
  sp_role_permissions: RolePermissionsTable
  sp_products: ProductsTable
  sp_user_product_roles: UserProductRolesTable
  sp_teams: TeamsTable
  sp_team_members: TeamMembersTable
  sp_refresh_tokens: RefreshTokensTable
  sp_customers: CustomersTable
  sp_customer_emails: CustomerEmailsTable
  sp_customer_products: CustomerProductsTable
  sp_ticket_statuses: TicketStatusesTable
  sp_ticket_priorities: TicketPrioritiesTable
  sp_product_counters: ProductCountersTable
  sp_tickets: TicketsTable
  sp_tags: TagsTable
  sp_ticket_tags: TicketTagsTable
  sp_ticket_messages: TicketMessagesTable
  sp_ticket_activities: TicketActivitiesTable
  sp_attachments: AttachmentsTable
  sp_email_providers: EmailProvidersTable
  sp_product_email_providers: ProductEmailProvidersTable
  sp_saved_views: SavedViewsTable
  sp_audit_logs: AuditLogsTable
  sp_settings: SettingsTable
  sp_inbound_addresses: InboundAddressesTable
  sp_email_ingest_log: EmailIngestLogTable
  sp_email_delivery_events: EmailDeliveryEventsTable
  sp_jobs: JobsTable
  schema_migrations: SchemaMigrationsTable
}

export type User = Selectable<UsersTable>
export type NewUser = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>
export type Ticket = Selectable<TicketsTable>
export type Product = Selectable<ProductsTable>
