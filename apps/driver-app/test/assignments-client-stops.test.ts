// apps/driver-app/test/assignments-client-stops.test.ts
// outside-in strict TDD: driver-app parity with the Lệnh điều xe - Tải thùng
// dispatch workflow. The form creates 1..N pickup warehouses + a delivery
// (multi-stop). The API ListAssignedRow carries the full stops[] array
// (sequence/stopType/plannedAt/warehouseName/arrivedAt/departedAt/hasManifest).
// The mobile AssignmentsClient.parseRow must preserve every stop in sequence,
// not collapse to a single pickupName/deliveryName. hasManifest is the per-stop
// committed-proof signal the delivery-capture gate consumes; it defaults false
// for pre-gate payloads (back-compat).
import { describe, it, expect, vi } from 'vitest';
import { AssignmentsClient } from '../src/assignments/assignments-client.js';
const multiStopRow = {
  transportOrderId: 'to-ms', roadRunId: 'rr-ms', state: 'dispatched',
  plannedStartAt: '2026-05-10T08:00:00Z', startedAt: null, completedAt: null,
  plate: '62H-99999', orderRef: 'XTT.05-007', customerName: 'ABC',
  pickupName: 'Kho nhận 1', deliveryName: 'Kho giao',
  stops: [
    { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-10T08:00:00Z', warehouseName: 'Kho nhận 1', arrivedAt: null, departedAt: null, hasManifest: true },
    { sequence: 2, stopType: 'pickup', plannedAt: '2026-05-10T09:00:00Z', warehouseName: 'Kho nhận 2', arrivedAt: null, departedAt: null, hasManifest: false },
    { sequence: 3, stopType: 'pickup', plannedAt: '2026-05-10T10:00:00Z', warehouseName: 'Kho nhận 3', arrivedAt: null, departedAt: null, hasManifest: false },
    { sequence: 4, stopType: 'delivery', plannedAt: '2026-05-10T14:00:00Z', warehouseName: 'Kho giao', arrivedAt: null, departedAt: null, hasManifest: false },
  ],
};
function clientFor(payload: unknown): AssignmentsClient {
  const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
  return new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
}
describe('AssignmentsClient multi-stop parity (Lệnh điều xe workflow)', () => {
  it('preserves every stop from the dispatch form in sequence', async () => {
    const rows = await clientFor({ rows: [multiStopRow] }).list();
    expect(rows[0]?.stops).toHaveLength(4);
    expect(rows[0]?.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
    expect(rows[0]?.stops.map((s) => s.stopType)).toEqual(['pickup', 'pickup', 'pickup', 'delivery']);
    expect(rows[0]?.stops.map((s) => s.warehouseName)).toEqual(['Kho nhận 1', 'Kho nhận 2', 'Kho nhận 3', 'Kho giao']);
  });
  it('preserves per-stop timing fields (plannedAt/arrivedAt/departedAt)', async () => {
    const rows = await clientFor({ rows: [multiStopRow] }).list();
    const s0 = rows[0]?.stops[0];
    expect(s0?.plannedAt).toBe('2026-05-10T08:00:00Z');
    expect(s0?.arrivedAt).toBe(null);
    expect(s0?.departedAt).toBe(null);
  });
  it('preserves per-stop hasManifest committed-proof signal', async () => {
    const rows = await clientFor({ rows: [multiStopRow] }).list();
    expect(rows[0]?.stops.map((s) => s.hasManifest)).toEqual([true, false, false, false]);
  });
  it('defaults hasManifest to false when the field is absent (back-compat)', async () => {
    const legacyStop = { sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: null, arrivedAt: null, departedAt: null };
    const rows = await clientFor({ rows: [{ ...multiStopRow, stops: [legacyStop] }] }).list();
    expect(rows[0]?.stops[0]?.hasManifest).toBe(false);
  });
  it('rejects when a stop hasManifest is present but not a boolean', async () => {
    const bad = { ...multiStopRow, stops: [{ sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: null, arrivedAt: null, departedAt: null, hasManifest: 'yes' }] };
    await expect(clientFor({ rows: [bad] }).list()).rejects.toThrow(/hasManifest/);
  });
  it('defaults stops to empty array when omitted (backward-compatible)', async () => {
    const legacy = { transportOrderId: 'to', roadRunId: 'r', state: 's', plannedStartAt: null, startedAt: null, completedAt: null, plate: null, orderRef: null, customerName: null, pickupName: null, deliveryName: null };
    const rows = await clientFor({ rows: [legacy] }).list();
    expect(rows[0]?.stops).toEqual([]);
  });
  it('rejects when stops is present but not an array', async () => {
    const bad = { ...multiStopRow, stops: 'not-array' };
    await expect(clientFor({ rows: [bad] }).list()).rejects.toThrow(/stops must be array/);
  });
  it('rejects when a stop sequence is not a number', async () => {
    const bad = { ...multiStopRow, stops: [{ sequence: 'x', stopType: 'pickup', plannedAt: null, warehouseName: null, arrivedAt: null, departedAt: null }] };
    await expect(clientFor({ rows: [bad] }).list()).rejects.toThrow(/sequence/);
  });
  it('rejects when a stop stopType is not a string', async () => {
    const bad = { ...multiStopRow, stops: [{ sequence: 1, stopType: 99, plannedAt: null, warehouseName: null, arrivedAt: null, departedAt: null }] };
    await expect(clientFor({ rows: [bad] }).list()).rejects.toThrow(/stopType/);
  });
});
