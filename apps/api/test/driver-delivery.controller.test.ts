// apps/api/test/driver-delivery.controller.test.ts
// TDD: POST /driver/assignments/:roadRunId/{accept,start,complete}
// delegate to DriverDeliveryService with the authenticated operator.
import { describe, it, expect, vi } from 'vitest';

const { DriverDeliveryController } = await import('../src/dispatch/driver-delivery.controller.js');

const op = { operatorId: 'op-1', companyId: 'co-1' } as never;

describe('@fleet/api - DriverDeliveryController', () => {
  it('POST accept delegates to service.accept(roadRunId, op)', async () => {
    const accept = vi.fn(() =>
      Promise.resolve({
        roadRunId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
        state: 'dispatched' as const,
      }),
    );
    const ctrl = new DriverDeliveryController({ accept } as never);
    const res = await ctrl.accept('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', op);
    expect(res).toEqual({ roadRunId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', state: 'dispatched' });
    expect(accept).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', op);
  });

  it('POST start delegates to service.start', async () => {
    const start = vi.fn(() =>
      Promise.resolve({
        roadRunId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
        state: 'started' as const,
      }),
    );
    const ctrl = new DriverDeliveryController({ start } as never);
    expect(await ctrl.start('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', op)).toEqual({
      roadRunId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      state: 'started',
    });
  });

  it('POST complete delegates to service.complete', async () => {
    const complete = vi.fn(() =>
      Promise.resolve({
        roadRunId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
        state: 'completed' as const,
      }),
    );
    const ctrl = new DriverDeliveryController({ complete } as never);
    expect(await ctrl.complete('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', op)).toEqual({
      roadRunId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      state: 'completed',
    });
  });
});
