// apps/driver-app/test/assignments-client-stops.test.ts
// outside-in strict TDD RED: driver-app parity with the Lệnh điều xe - Tải thùng
// dispatch workflow. The form creates 1..N pickup warehouses + a delivery
// (multi-stop). The API ListAssignedRow already carries the full stops[] array
// (sequence/stopType/plannedAt/warehouseName/arrivedAt/departedAt). The mobile
// AssignmentsClient.parseRow must preserve every stop in sequence, not collapse
// to a single pickupName/deliveryName. Business invariant: 1-1 match between
// driver-app and the dispatch form workflow.
import { describe, it, expect, vi } from 'vitest';
import { createListAssignedRow, createListAssignedStop } from '@fleet/test-fixtures';
import { AssignmentsClient } from '../src/assignments/assignments-client.js';

// Built THROUGH ListAssignedRowSchema: the previous literal omitted
// externalRef, createdAt, cargoName, driverName, canCancel and
// cancelBlockedReason, the same six the hand-rolled parser dropped.
const multiStopRow = createListAssignedRow({
  transportOrderId: 'to-ms',
  roadRunId: 'rr-ms',
  state: 'dispatched',
  plannedStartAt: '2026-05-10T08:00:00Z',
  startedAt: null,
  completedAt: null,
  plate: '62H-99999',
  orderRef: 'XTT.05-007',
  customerName: 'ABC',
  pickupName: 'Kho nhận 1',
  deliveryName: 'Kho giao',
  // Stops go through the STOP factory, not inline literals. proof is
  // .default(null) on ListAssignedRowStopSchema, so it is optional on input
  // and REQUIRED on the z.infer output type -- a literal annotated as the
  // contract type must supply it, while the factory parses the schema and
  // lets the default apply. That asymmetry is what broke these four lines
  // when this arc added proof; routing through the factory means the next
  // contract field will not break them again.
  stops: [
    createListAssignedStop({
      sequence: 1,
      stopType: 'pickup',
      plannedAt: '2026-05-10T08:00:00Z',
      warehouseName: 'Kho nhận 1',
    }),
    createListAssignedStop({
      sequence: 2,
      stopType: 'pickup',
      plannedAt: '2026-05-10T09:00:00Z',
      warehouseName: 'Kho nhận 2',
    }),
    createListAssignedStop({
      sequence: 3,
      stopType: 'pickup',
      plannedAt: '2026-05-10T10:00:00Z',
      warehouseName: 'Kho nhận 3',
    }),
    createListAssignedStop({
      sequence: 4,
      stopType: 'delivery',
      plannedAt: '2026-05-10T14:00:00Z',
      warehouseName: 'Kho giao',
    }),
  ],
});
function clientFor(payload: unknown): AssignmentsClient {
  const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
  return new AssignmentsClient({
    apiUrl: 'http://api',
    bearerToken: () => 't',
    fetchFn: fetchFn as never,
  });
}
// Rejection assertions check THAT a malformed stops[] throws, not the wording.
// The messages they matched ('stops must be array', and the sequence/stopType
// guards) came from parseStop/parseRow, deleted in favour of the shared
// contract. Zod reports structured issues; matching its prose would re-couple
// these tests to a new implementation detail.
describe('AssignmentsClient multi-stop parity (Lệnh điều xe workflow)', () => {
  it('preserves every stop from the dispatch form in sequence', async () => {
    const rows = await clientFor({ rows: [multiStopRow] }).list();
    expect(rows[0]?.stops).toHaveLength(4);
    expect(rows[0]?.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
    expect(rows[0]?.stops.map((s) => s.stopType)).toEqual([
      'pickup',
      'pickup',
      'pickup',
      'delivery',
    ]);
    expect(rows[0]?.stops.map((s) => s.warehouseName)).toEqual([
      'Kho nhận 1',
      'Kho nhận 2',
      'Kho nhận 3',
      'Kho giao',
    ]);
  });
  it('preserves per-stop timing fields (plannedAt/arrivedAt/departedAt)', async () => {
    const rows = await clientFor({ rows: [multiStopRow] }).list();
    const s0 = rows[0]?.stops[0];
    expect(s0?.plannedAt).toBe('2026-05-10T08:00:00Z');
    expect(s0?.arrivedAt).toBe(null);
    expect(s0?.departedAt).toBe(null);
  });
  // A row with NO stops is carried through as an empty list. The old assertion
  // here omitted the stops key entirely, relying on the hand-rolled parser
  // defaulting it -- a tolerance for a shape the server cannot produce: stops[]
  // has been on every response since the multi-stop arc, and the api and
  // ops-web paths already parse the strict contract. Tolerating client-side
  // what no producer emits IS the drift this refactor removes.
  it('carries a stopless row through as an empty list', async () => {
    const stopless = createListAssignedRow({
      transportOrderId: 'to',
      roadRunId: 'r',
      state: 's',
      stops: [],
    });
    const rows = await clientFor({ rows: [stopless] }).list();
    expect(rows[0]?.stops).toEqual([]);
  });
  it('rejects when stops is present but not an array', async () => {
    const bad = { ...multiStopRow, stops: 'not-array' };
    await expect(clientFor({ rows: [bad] }).list()).rejects.toThrow();
  });
  it('rejects when a stop sequence is not a number', async () => {
    const bad = {
      ...multiStopRow,
      stops: [
        {
          sequence: 'x',
          stopType: 'pickup',
          plannedAt: null,
          warehouseName: null,
          arrivedAt: null,
          departedAt: null,
        },
      ],
    };
    await expect(clientFor({ rows: [bad] }).list()).rejects.toThrow();
  });
  it('rejects when a stop stopType is not a string', async () => {
    const bad = {
      ...multiStopRow,
      stops: [
        {
          sequence: 1,
          stopType: 99,
          plannedAt: null,
          warehouseName: null,
          arrivedAt: null,
          departedAt: null,
        },
      ],
    };
    await expect(clientFor({ rows: [bad] }).list()).rejects.toThrow();
  });
});
