// apps/driver-app/test/assignments-client-schema-first.test.ts
// RED: list() and tripHistory() must validate through the SHARED contract, not
// a hand-rolled parser.
//
// THE VIOLATION. assignments-client.ts hand-writes StopRow / AssignmentRow /
// TripHistoryMonth and ~60 lines of parseStop/parseRow/parseMonth, while
// list-assigned-contract.ts already exports ListAssignedRowStopSchema,
// ListAssignedRowSchema, ListAssignedResponseSchema and
// TripHistoryResponseSchema for exactly those shapes. Two definitions of one
// wire contract, free to drift -- Axis 2.
//
// The file already knows better. Its own completed() method says: "this read
// has no hand-rolled parser -- the shared contract IS the parser". The other
// two reads never got the same treatment.
//
// THE DRIFT IS ALREADY REAL, not hypothetical. parseRow silently DROPS six
// fields the contract carries: externalRef, createdAt, cargoName, driverName,
// canCancel and cancelBlockedReason. canCancel in particular is the
// server-computed cancel affordance -- the client is meant never to re-derive
// that rule, and here it cannot even see it.
import { describe, it, expect } from 'vitest';
import { ListAssignedRowSchema } from '@fleet/sync-protocol';
import { AssignmentsClient } from '../src/assignments/assignments-client.ts';

const ROW = {
  transportOrderId: 'to-1',
  externalRef: 'XTT.08-001',
  roadRunId: 'rr-1',
  state: 'completed',
  plannedStartAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  startedAt: '2026-08-01T01:00:00.000Z',
  completedAt: '2026-08-01T05:00:00.000Z',
  orderRef: 'XTT.08-001',
  plate: '51C-123.45',
  customerName: 'Khách A',
  cargoName: 'Gạo',
  driverName: 'Tài xế B',
  pickupName: 'Kho 1',
  deliveryName: 'Kho 2',
  stops: [
    {
      sequence: 1,
      stopType: 'pickup',
      plannedAt: null,
      warehouseName: 'Kho 1',
      arrivedAt: null,
      departedAt: null,
    },
  ],
  canCancel: false,
  cancelBlockedReason: 'photos_received',
};

function clientReturning(payload: unknown): AssignmentsClient {
  const fetchFn = ((): Promise<Response> =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    } as Response)) as typeof globalThis.fetch;
  return new AssignmentsClient({ apiUrl: 'http://api.invalid', bearerToken: () => 't', fetchFn });
}

describe('AssignmentsClient.list is schema-first', () => {
  it('returns rows that satisfy the SHARED contract', async () => {
    const rows = await clientReturning({ rows: [ROW] }).list();
    expect(ListAssignedRowSchema.safeParse(rows[0]).success).toBe(true);
  });

  // The six fields the hand-rolled parser dropped. canCancel is the
  // server-computed cancel affordance the client must never re-derive.
  it('preserves the fields the hand-rolled parser silently dropped', async () => {
    const row = (await clientReturning({ rows: [ROW] }).list())[0];
    expect(row?.externalRef).toBe('XTT.08-001');
    expect(row?.createdAt).toBe('2026-08-01T00:00:00.000Z');
    expect(row?.cargoName).toBe('Gạo');
    expect(row?.driverName).toBe('Tài xế B');
    expect(row?.canCancel).toBe(false);
    expect(row?.cancelBlockedReason).toBe('photos_received');
  });

  it('still rejects a malformed row at the boundary', async () => {
    await expect(clientReturning({ rows: [{ roadRunId: 1 }] }).list()).rejects.toThrow();
  });

  it('rejects an envelope that is not the contract shape', async () => {
    await expect(clientReturning({ notRows: [] }).list()).rejects.toThrow();
  });
});

describe('AssignmentsClient.tripHistory is schema-first', () => {
  it('parses the month envelope through the shared contract', async () => {
    const months = await clientReturning({
      months: [{ monthKey: '2026-08', label: 'Tháng 8/2026', count: 1, trips: [ROW] }],
    }).tripHistory();
    expect(months[0]?.monthKey).toBe('2026-08');
    expect(ListAssignedRowSchema.safeParse(months[0]?.trips[0]).success).toBe(true);
  });

  it('rejects a month whose count is not a non-negative integer', async () => {
    await expect(
      clientReturning({
        months: [{ monthKey: '2026-08', label: 'x', count: -1, trips: [] }],
      }).tripHistory(),
    ).rejects.toThrow();
  });
});
