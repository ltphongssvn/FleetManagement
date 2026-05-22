// apps/api/test/transport-orders.service.defensive-throws.test.ts
// Unit tests covering the two defensive throws in TransportOrdersService.create:
//   - if (!created) throw new Error('transport_order insert failed')
//   - if (!rr)      throw new Error('road_run insert failed')
//
// These throw paths are unreachable from real Postgres/PGlite because a
// successful INSERT ... RETURNING always returns at least the inserted row.
// They exist as defense-in-depth against an unusual DB-driver state. We mock
// the tx with a minimal fake so we can drive each throw deterministically.
//
// Same fake-tx pattern as admin-drivers-create.service.test.ts ("throws when
// the DB returns no row").
import { describe, it, expect } from 'vitest';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import type { OrderNumberingService } from '../src/transport-orders/order-numbering.service.js';
import { createOperatorContext } from '@fleet/test-fixtures';
const stubNumbering = { allocate: async (): Promise<string> => 'XT.001' } as unknown as OrderNumberingService;
type ReturningFn = () => Promise<unknown[]>;
type ValuesFn = (v: unknown) => { returning: ReturningFn } | Promise<unknown>;
function makeTx(opts: { transportOrderRows: unknown[]; roadRunRows: unknown[] }): unknown {
  let insertCallIdx = 0;
  return {
    select: (): {
      from: () => {
        innerJoin: () => {
          where: () => { limit: () => Promise<unknown[]> };
        };
      };
    } => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            // pair guard finds an active assignment, so we proceed past line 55
            limit: (): Promise<unknown[]> => Promise.resolve([{ assignmentId: 'a-1' }]),
          }),
        }),
      }),
    }),
    insert: (): { values: ValuesFn } => ({
      values: (_v: unknown) => {
        const idx = insertCallIdx;
        insertCallIdx += 1;
        if (idx === 0) {
          // transport_order insert
          return { returning: (): Promise<unknown[]> => Promise.resolve(opts.transportOrderRows) };
        }
        if (idx === 1) {
          // stop insert — no returning() in production code, so resolve void
          return Promise.resolve(undefined) as unknown as { returning: ReturningFn };
        }
        if (idx === 2) {
          // road_run insert
          return { returning: (): Promise<unknown[]> => Promise.resolve(opts.roadRunRows) };
        }
        // road_run_transport_order insert (or any further) — no returning()
        return Promise.resolve(undefined) as unknown as { returning: ReturningFn };
      },
    }),
  };
}
function makeDb(opts: { transportOrderRows: unknown[]; roadRunRows: unknown[] }): unknown {
  return {
    transaction: async <T,>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(makeTx(opts)),
  };
}
const op = createOperatorContext();
const validInput = {
  externalRef: 'TO-DEFENSE',
  stops: [{ sequence: 1, stopType: 'pickup' }],
  roadRun: {
    assignedOperatorId: '00000000-0000-0000-0000-0000000000a1',
    assignedAssetId: '00000000-0000-0000-0000-0000000000b2',
  },
};
describe('@fleet/api - TransportOrdersService defensive throws', () => {
  it('throws when transport_order insert returns no row (line 62 branch)', async () => {
    const svc = new TransportOrdersService(makeDb({
      transportOrderRows: [],
      roadRunRows: [{ roadRunId: 'rr-x' }],
    }) as never, stubNumbering);
    await expect(svc.create(validInput, op))
      .rejects.toThrow(/transport_order insert failed/);
  });
  it('throws when road_run insert returns no row (line 80 branch)', async () => {
    const svc = new TransportOrdersService(makeDb({
      transportOrderRows: [{ transportOrderId: 'to-x' }],
      roadRunRows: [],
    }) as never, stubNumbering);
    await expect(svc.create(validInput, op))
      .rejects.toThrow(/road_run insert failed/);
  });
});
