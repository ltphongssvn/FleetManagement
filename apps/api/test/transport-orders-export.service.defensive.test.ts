// apps/api/test/transport-orders-export.service.defensive.test.ts
//
// Branch coverage for the defensive throw at line 122 (transport-orders-export.service.ts):
//   if (!inserted) throw new Error('transport_order_export_log insert failed');
// Drizzle's .returning() should never yield an empty array on a successful
// INSERT, but the guard exists so we don't silently return a malformed
// ExportResult if the driver ever changes. This test forces that branch
// with a mock db.
import { describe, it, expect, vi } from 'vitest';
import { TransportOrdersExportService } from '../src/transport-orders/transport-orders-export.service.js';
import { createOperatorContext } from '@fleet/test-fixtures';
describe('@fleet/api - TransportOrdersExportService defensive branches', () => {
  it('throws when INSERT ... RETURNING yields no row (line 122 guard)', async () => {
    const insertBuilder = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    const selectBuilder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockResolvedValue([]),
    };
    const db = {
      select: vi.fn().mockReturnValue(selectBuilder),
      insert: vi.fn().mockReturnValue(insertBuilder),
    };
    const svc = new TransportOrdersExportService(db as never);
    const op = createOperatorContext();
    await expect(svc.exportAndLog(op, 'manual')).rejects.toThrow(
      /transport_order_export_log insert failed/,
    );
  });
});
