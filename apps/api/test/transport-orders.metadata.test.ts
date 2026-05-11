// apps/api/test/transport-orders.metadata.test.ts
// RED: API accepts and persists metadata field on transport_order.
import { describe, it, expect } from 'vitest';
import { CreateTransportOrderSchema } from '../src/transport-orders/transport-orders.dto.js';
describe('CreateTransportOrderSchema metadata', () => {
  it('accepts metadata object with VN fields', () => {
    const r = CreateTransportOrderSchema.safeParse({
      externalRef: 'XT.001',
      metadata: { customer: 'ĐẠI THÀNH', cargo: 'GẠO', vehiclePlate: '62H 05817' },
      stops: [{ sequence: 1, stopType: 'pickup' }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.metadata).toEqual({ customer: 'ĐẠI THÀNH', cargo: 'GẠO', vehiclePlate: '62H 05817' });
    }
  });
  it('accepts request without metadata (backwards compat)', () => {
    const r = CreateTransportOrderSchema.safeParse({
      externalRef: 'XT.002',
      stops: [{ sequence: 1, stopType: 'pickup' }],
    });
    expect(r.success).toBe(true);
  });
});
