// apps/api/test/transport-orders.metadata.test.ts
// API accepts and persists metadata field on transport_order. Each request
// now also requires a valid roadRun (with assignedOperatorId + assignedAssetId)
// because the DTO enforces driver+truck assignment at create time.
import { describe, it, expect } from 'vitest';
import { CreateTransportOrderSchema } from '../src/transport-orders/transport-orders.dto.js';
const validRoadRun = {
  assignedOperatorId: '00000000-0000-0000-0000-0000000000a1',
  assignedAssetId: '00000000-0000-0000-0000-0000000000b2',
};
describe('CreateTransportOrderSchema metadata', () => {
  it('accepts metadata object with VN fields', () => {
    const r = CreateTransportOrderSchema.safeParse({
      externalRef: 'XT.001',
      metadata: { customer: 'ĐẠI THÀNH', cargo: 'GẠO', vehiclePlate: '62H 05817' },
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: validRoadRun,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.metadata).toEqual({ customer: 'ĐẠI THÀNH', cargo: 'GẠO', vehiclePlate: '62H 05817' });
    }
  });
  it('accepts request without metadata (metadata still optional)', () => {
    const r = CreateTransportOrderSchema.safeParse({
      externalRef: 'XT.002',
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: validRoadRun,
    });
    expect(r.success).toBe(true);
  });
});
