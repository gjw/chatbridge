import type { z } from 'zod'
import { pool } from './pool.js'

/** Execute a query and validate each row against a Zod schema. */
export async function queryRows<T>(
  schema: z.ZodType<T>,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query(sql, params)
  return result.rows.map((row: unknown) => schema.parse(row))
}

/** Execute a query expecting exactly one row. Throws if 0 or 2+. */
export async function queryOne<T>(
  schema: z.ZodType<T>,
  sql: string,
  params?: unknown[],
): Promise<T> {
  const rows = await queryRows(schema, sql, params)
  const first = rows[0]
  if (first === undefined) {
    throw new Error(`Expected 1 row, got ${String(rows.length)}`)
  }
  if (rows.length > 1) {
    throw new Error(`Expected 1 row, got ${String(rows.length)}`)
  }
  return first
}

/** Execute a mutation (INSERT/UPDATE/DELETE). Returns row count. */
export async function execute(
  sql: string,
  params?: unknown[],
): Promise<number> {
  const result = await pool.query(sql, params)
  return result.rowCount ?? 0
}
