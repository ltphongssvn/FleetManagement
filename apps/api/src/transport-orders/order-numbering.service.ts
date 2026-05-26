// apps/api/src/transport-orders/order-numbering.service.ts
//
// Atomic per-company, per-month order-number allocator. The dispatcher
// never types the Số Lệnh; the server is the single source of truth.
//
// Format (2026-Q2 contract change): prefix.MM-NNN where:
//   prefix = 'XTT' (3-letter, was 'XT')
//   MM     = 2-digit UTC month of allocation, 01..12
//   NNN    = 3-digit per-month sequence, resets to 001 on every new month
// Examples: XTT.06-001 (first June order), XTT.07-001 (first July order).
//
// Concurrency: SELECT ... FOR UPDATE on the order_sequence row serializes
// concurrent allocations within a company so two parallel POST /transport-
// orders calls cannot collide on the same number. The lock is released when
// the surrounding transaction commits.
//
// Monthly rebase under the lock: instead of trusting order_sequence.
// next_value (which now has no meaningful global semantics because the
// per-month NNN restarts), we compute MAX(numeric suffix) of existing
// transport_order.external_ref rows matching prefix.MM- for the current
// month + company. The returned NNN is MAX + 1 (or 1 if no rows yet).
// This makes month-rollover automatic with no schema migration: as soon
// as 'now.getUTCMonth' lands in a new month, the rebase query no longer
// matches last month's rows and starts at 001.
//
// The order_sequence row is retained because (a) the FOR UPDATE lock on
// it serializes concurrent allocators (no lock object inserted just for
// numbering), and (b) keeping the row preserves the original lazy-init
// semantics for new (company, prefix) tenants.
//
// Tenancy: order_sequence is scoped by company_id + prefix (unique
// constraint order_sequence_company_prefix_uq). Tenancy columns from the
// OperatorContext are written on first-time insert.
//
// 'now' parameter: optional Date, defaults to new Date(). Injecting the
// clock keeps tests deterministic across month boundaries.
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { orderSequence } from '../database/schema/reference.js';
import type { OperatorContext } from '../auth/operator-context.js';
export const DEFAULT_ORDER_PREFIX = 'XTT';
export const MONTHLY_PAD_WIDTH = 3;
type Tx = FleetDb | Parameters<Parameters<FleetDb['transaction']>[0]>[0];
function pad2(n: number): string { return n < 10 ? '0' + String(n) : String(n); }
function formatMonthly(prefix: string, month: number, value: number): string {
  return prefix + '.' + pad2(month) + '-' + String(value).padStart(MONTHLY_PAD_WIDTH, '0');
}
@Injectable()
export class OrderNumberingService {
  // Constructor intentionally no-arg: allocations always use the caller's
  // transaction handle so the allocator participates in the surrounding
  // unit of work. No injected db field is needed.
  async allocate(
    tx: Tx,
    op: OperatorContext,
    prefix: string = DEFAULT_ORDER_PREFIX,
    now: Date = new Date(),
  ): Promise<string> {
    // Race-safe lazy initialization of the lock row. next_value is no
    // longer authoritative for the returned NNN (the monthly rebase below
    // is), so the initial value is informational only — kept at 1 for
    // backward compatibility with any tool that reads order_sequence.
    await tx.insert(orderSequence).values({
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      prefix,
      nextValue: 1,
      padWidth: MONTHLY_PAD_WIDTH,
    }).onConflictDoNothing({
      target: [orderSequence.companyId, orderSequence.prefix],
    });
    const [row] = await tx.select().from(orderSequence)
      .where(and(eq(orderSequence.companyId, op.companyId), eq(orderSequence.prefix, prefix)))
      .for('update');
    /* v8 ignore next -- defensive: the row was just upserted */
    if (!row) throw new Error('order_sequence row missing after upsert');
    const month = now.getUTCMonth() + 1;
    const monthPrefix = prefix + '.' + pad2(month) + '-';
    // Monthly rebase inside the lock: compute MAX(numeric suffix after the
    // prefix.MM- portion) for the same company. Pattern length = prefix +
    // '.' + 2 digits + '-' = prefix.length + 4. SUBSTRING is 1-indexed in
    // Postgres, so we ask for position prefix.length + 5 onwards.
    const suffixStart = monthPrefix.length + 1;
    const monthRegex = '^' + prefix + '\\.' + pad2(month) + '-[0-9]+$';
    const maxRows = await tx.execute<{ max_num: number | null }>(sql.raw(
      'SELECT MAX(CAST(SUBSTRING(external_ref FROM ' + String(suffixStart) +
      ') AS INTEGER)) AS max_num FROM transport_order WHERE company_id = ' +
      String.fromCharCode(39) + op.companyId + String.fromCharCode(39) +
      ' AND external_ref LIKE ' + String.fromCharCode(39) + monthPrefix + '%' + String.fromCharCode(39) +
      ' AND external_ref ~ ' + String.fromCharCode(39) + monthRegex + String.fromCharCode(39),
    ));
    const maxNumRow = maxRows.rows[0];
    const maxExisting = maxNumRow !== undefined && maxNumRow.max_num !== null ? maxNumRow.max_num : 0;
    const value = maxExisting + 1;
    // Keep next_value moving forward across allocations within the lock
    // for legacy tooling; semantically the source of truth is the MAX
    // rebase above.
    await tx.update(orderSequence)
      .set({ nextValue: Math.max(row.nextValue, value) + 1, updatedAt: new Date() })
      .where(eq(orderSequence.orderSequenceId, row.orderSequenceId));
    return formatMonthly(prefix, month, value);
  }
}
