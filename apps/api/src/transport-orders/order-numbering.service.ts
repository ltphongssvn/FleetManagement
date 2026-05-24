// apps/api/src/transport-orders/order-numbering.service.ts
//
// Atomic per-company order-number allocator. The dispatcher never types the
// Số Lệnh; the server is the single source of truth for transport_order
// numbering. Pattern: prefix.NNNN, e.g. XT.0001, XT.0002.
//
// Concurrency: SELECT ... FOR UPDATE on the order_sequence row serializes
// concurrent allocations within a company so two parallel POST /transport-
// orders calls cannot collide on the same number. The lock is released when
// the surrounding transaction commits.
//
// Lazy initialization: if no order_sequence row exists for (company, prefix),
// the allocator INSERTs one with ON CONFLICT DO NOTHING (so N concurrent
// first-time callers do not collide on the unique constraint) and then
// re-selects FOR UPDATE to drive the same lock-then-increment path as the
// steady-state case.
//
// Legacy-data hardening (2026-05-22): pre-existing transport_order rows
// can be present whose external_ref was inserted via a path that bypassed
// this allocator (manual SQL, imports, schema reload from snapshot). In
// that case order_sequence.next_value lags MAX(existing external_ref) and
// the naive next-value-as-candidate path collides on
// transport_order_company_external_ref_uq. After taking the FOR UPDATE
// lock, the allocator therefore reads MAX(numeric suffix of existing
// external_ref) for the same company and prefix and rebases next_value to
// strictly greater than that max. The rebase happens inside the lock, so
// two concurrent allocators still serialize cleanly.
//
// Tenancy: the order_sequence row is scoped by company_id + prefix (unique
// constraint order_sequence_company_prefix_uq). All tenancy columns from
// OperatorContext are written on first-time insert so the row participates
// in the same tenancy model as every other table in the schema.
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { orderSequence } from '../database/schema/reference.js';
import type { OperatorContext } from '../auth/operator-context.js';
export const DEFAULT_ORDER_PREFIX = 'XT';
export const DEFAULT_PAD_WIDTH = 4;
type Tx = FleetDb | Parameters<Parameters<FleetDb['transaction']>[0]>[0];
function format(prefix: string, value: number, pad: number): string {
  return prefix + '.' + String(value).padStart(pad, '0');
}
@Injectable()
export class OrderNumberingService {
  // Constructor intentionally no-arg: allocations always use the caller's
  // transaction handle so the allocator participates in the surrounding
  // unit of work. No injected db field is needed.
  async allocate(tx: Tx, op: OperatorContext, prefix: string = DEFAULT_ORDER_PREFIX): Promise<string> {
    // Race-safe lazy initialization: try to insert the seed row with
    // ON CONFLICT DO NOTHING. If we lose the race, the winner's row is
    // already there and our re-SELECT FOR UPDATE will see it.
    await tx.insert(orderSequence).values({
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      prefix,
      nextValue: 1,
      padWidth: DEFAULT_PAD_WIDTH,
    }).onConflictDoNothing({
      target: [orderSequence.companyId, orderSequence.prefix],
    });
    const [row] = await tx.select().from(orderSequence)
      .where(and(eq(orderSequence.companyId, op.companyId), eq(orderSequence.prefix, prefix)))
      .for('update');
    /* v8 ignore next -- defensive: the row was just upserted */
    if (!row) throw new Error('order_sequence row missing after upsert');
    // Legacy-data rebase: inside the FOR UPDATE lock, check the actual
    // maximum numeric suffix of existing transport_order.external_ref rows
    // for this company and prefix. If next_value lags that maximum, jump
    // ahead. This guarantees the returned number is strictly greater than
    // any existing ref, so the surrounding insert cannot collide on the
    // unique constraint.
    const prefixDotPattern = prefix + '.';
    const maxRows = await tx.execute<{ max_num: number | null }>(sql.raw(
      "SELECT MAX(CAST(SUBSTRING(external_ref FROM " + String(prefixDotPattern.length + 1) +
      ") AS INTEGER)) AS max_num FROM transport_order WHERE company_id = '" + op.companyId +
      "' AND external_ref LIKE '" + prefixDotPattern + "%' AND external_ref ~ '^" + prefix + "\\.[0-9]+$'",
    ));
    const maxNumRow = maxRows.rows[0];
    const maxExisting = maxNumRow !== undefined && maxNumRow.max_num !== null ? maxNumRow.max_num : 0;
    const value = Math.max(row.nextValue, maxExisting + 1);
    await tx.update(orderSequence)
      .set({ nextValue: value + 1, updatedAt: new Date() })
      .where(eq(orderSequence.orderSequenceId, row.orderSequenceId));
    return format(prefix, value, row.padWidth);
  }
}
