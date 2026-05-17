// apps/api/test/driver-delivery.controller.test.ts
// TDD: POST /driver/assignments/:roadRunId/{accept,start,complete}
// delegate to DriverDeliveryService with the authenticated operator.
import { describe, it, expect, vi } from 'vitest';

const { DriverDeliveryController } = await import('../src/dispatch/driver-delivery.controller.js');

const op = { operatorId: 'op-1', companyId: 'co-1' } as never;

describe('@fleet/api - DriverDeliveryController', () => {
  it('POST accept delegates to service.accept(roadRunId, op)', async () => {
    const accept = vi.fn(() => Promise.resolve({ roadRunId: 'rr-1', state: 'dispatched' as const }));
    const ctrl = new DriverDeliveryController({ accept } as never);
    const res = await ctrl.accept('rr-1', op);
    expect(res).toEqual({ roadRunId: 'rr-1', state: 'dispatched' });
    expect(accept).toHaveBeenCalledWith('rr-1', op);
  });

  it('POST start delegates to service.start', async () => {
    const start = vi.fn(() => Promise.resolve({ roadRunId: 'rr-1', state: 'started' as const }));
    const ctrl = new DriverDeliveryController({ start } as never);
    expect(await ctrl.start('rr-1', op)).toEqual({ roadRunId: 'rr-1', state: 'started' });
  });

  it('POST complete delegates to service.complete', async () => {
    const complete = vi.fn(() => Promise.resolve({ roadRunId: 'rr-1', state: 'completed' as const }));
    const ctrl = new DriverDeliveryController({ complete } as never);
    expect(await ctrl.complete('rr-1', op)).toEqual({ roadRunId: 'rr-1', state: 'completed' });
  });
});
