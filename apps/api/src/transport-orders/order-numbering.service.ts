// apps/api/src/transport-orders/order-numbering.service.ts
//
// Atomic per-company order-number allocator. The dispatcher never types the
// Số Lệnh; the server is the single source of truth for transport_order
// numbering. Pattern: {prefix}.{zero-padded sequence}, e.g. XT.001, XT.002.
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
// steady-state case. The database migration also seeds the default XT row
// per company; this lazy path is the safety net for newly created tenants
// whose seed has not yet run.
//
// Tenancy: the order_sequence row is scoped by company_id + prefix (unique
// constraint order_sequence_company_prefix_uq). All tenancy columns from
// OperatorContext are written on first-time insert so the row participates
// in the same tenancy model as every other table in the schema.
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
  // Allocate the next order number on the supplied transaction. The caller
  // owns the transaction so allocation, transport_order insert, and the
  // append-paths commit atomically.
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
    const value = row.nextValue;
    await tx.update(orderSequence)
      .set({ nextValue: value + 1, updatedAt: new Date() })
      .where(eq(orderSequence.orderSequenceId, row.orderSequenceId));
    return format(prefix, value, row.padWidth);
  }
}
