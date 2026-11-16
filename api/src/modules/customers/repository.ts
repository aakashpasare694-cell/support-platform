import type { Transaction } from 'kysely'
import { db, type DB } from '@/db/index.ts'

/** All customer SQL. Reads are scoped by the products a customer is associated with. */

export function findByEmail(email: string) {
  return db()
    .selectFrom('sp_customer_emails as ce')
    .innerJoin('sp_customers as c', 'c.id', 'ce.customer_id')
    .select(['c.id', 'c.name', 'c.company', 'c.phone', 'c.timezone', 'c.created_at'])
    .where('ce.email', '=', email.trim().toLowerCase())
    .executeTakeFirst()
}

export function getById(id: number, productIds: number[]) {
  return db()
    .selectFrom('sp_customers as c')
    .select(['c.id', 'c.name', 'c.company', 'c.phone', 'c.timezone', 'c.notes', 'c.created_at'])
    .where('c.id', '=', id)
    // Only visible if they are associated with a product the caller can see.
    .where(({ exists, selectFrom }) =>
      exists(
        selectFrom('sp_customer_products as cp')
          .select('cp.customer_id')
          .whereRef('cp.customer_id', '=', 'c.id')
          .where('cp.product_id', 'in', productIds.length ? productIds : [-1]),
      ),
    )
    .executeTakeFirst()
}

export async function list(productIds: number[], search: string, page: { page: number; perPage: number }) {
  const scope = db()
    .selectFrom('sp_customers as c')
    .where(({ exists, selectFrom }) =>
      exists(
        selectFrom('sp_customer_products as cp')
          .select('cp.customer_id')
          .whereRef('cp.customer_id', '=', 'c.id')
          .where('cp.product_id', 'in', productIds.length ? productIds : [-1]),
      ),
    )

  const withSearch = search.trim()
    ? scope.where((eb) =>
        eb.or([
          eb('c.name', 'like', `%${search.trim()}%`),
          eb('c.company', 'like', `%${search.trim()}%`),
          eb.exists(
            eb
              .selectFrom('sp_customer_emails as ce')
              .select('ce.customer_id')
              .whereRef('ce.customer_id', '=', 'c.id')
              .where('ce.email', 'like', `%${search.trim()}%`),
          ),
        ]),
      )
    : scope

  const rows = await withSearch
    .select(['c.id', 'c.name', 'c.company', 'c.phone', 'c.timezone', 'c.created_at'])
    .orderBy('c.name', 'asc')
    .limit(page.perPage)
    .offset((page.page - 1) * page.perPage)
    .execute()

  const counted = await withSearch.select(({ fn }) => fn.countAll<number>().as('total')).executeTakeFirst()
  return { rows, total: Number(counted?.total ?? 0) }
}

export async function emailsFor(customerIds: number[]) {
  if (!customerIds.length) return []
  return db()
    .selectFrom('sp_customer_emails')
    .select(['customer_id', 'email', 'is_primary'])
    .where('customer_id', 'in', customerIds)
    .execute()
}

export async function productsFor(customerIds: number[]) {
  if (!customerIds.length) return []
  return db()
    .selectFrom('sp_customer_products')
    .select(['customer_id', 'product_id'])
    .where('customer_id', 'in', customerIds)
    .execute()
}

/**
 * Finds the customer behind an address, or creates one.
 *
 * `sp_customer_emails.email` is unique, so a known address always resolves to
 * the existing profile — one person writing in about two products stays one
 * customer with two product associations.
 */
export async function resolveOrCreate(
  trx: Transaction<DB>,
  input: { email: string; name: string; company?: string | null; productId: number },
): Promise<number> {
  const email = input.email.trim().toLowerCase()

  const existing = await trx
    .selectFrom('sp_customer_emails')
    .select('customer_id')
    .where('email', '=', email)
    .executeTakeFirst()

  let customerId: number
  if (existing) {
    customerId = existing.customer_id
  } else {
    const res = await trx
      .insertInto('sp_customers')
      .values({ name: input.name.trim() || email, company: input.company?.trim() || null })
      .executeTakeFirstOrThrow()
    customerId = Number(res.insertId)
    await trx
      .insertInto('sp_customer_emails')
      .values({ customer_id: customerId, email, is_primary: 1 })
      .execute()
  }

  // Idempotent: the composite primary key makes a repeat association a no-op.
  await trx
    .insertInto('sp_customer_products')
    .values({ customer_id: customerId, product_id: input.productId })
    .onConflict((oc) => oc.columns(['customer_id', 'product_id']).doNothing())
    .execute()

  return customerId
}
