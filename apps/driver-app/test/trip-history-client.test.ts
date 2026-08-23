// apps/driver-app/test/trip-history-client.test.ts
// TDD RED: AssignmentsClient.tripHistory fetches GET /transport-orders/trip-history
// — the server-grouped monthly history — and validates the wire shape at the
// boundary. Months come pre-grouped by the API (shared @fleet/domain helper),
// so the driver app no longer groups client-side.
import { describe, it, expect, vi } from 'vitest';
import { createListAssignedRow } from '@fleet/test-fixtures';
import { AssignmentsClient, type AssignmentRow } from '../src/assignments/assignments-client.js';

// Built THROUGH ListAssignedRowSchema. The previous hand-written literal was
// missing externalRef, createdAt, cargoName, driverName, canCancel and
// cancelBlockedReason -- the SAME six fields the hand-rolled parser dropped, so
// fixture and parser agreed with each other while neither matched the wire. A
// factory cannot drift: a row that stops satisfying the contract fails at
// construction.
function completedRow(id: string, completedAt: string): AssignmentRow {
  return createListAssignedRow({
    transportOrderId: 'to-' + id,
    roadRunId: 'rr-' + id,
    state: 'completed',
    plannedStartAt: null,
    startedAt: null,
    completedAt,
    plate: null,
    orderRef: id,
    customerName: null,
    pickupName: null,
    deliveryName: null,
    stops: [],
  });
}
// Rejection assertions below check THAT a malformed payload throws, not the
// wording: the messages they used to match ('months must be array',
// 'AssignmentRow: not an object') came from parseMonth/parseRow, which this
// refactor deleted in favour of the shared contract. Zod reports structured
// issues instead, so matching its prose would just re-couple these tests to a
// new implementation detail.
describe('AssignmentsClient.tripHistory', () => {
  it('GETs /transport-orders/trip-history with the bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ months: [] }),
    });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => 'tok',
      fetchFn: fetchFn as never,
    });
    await client.tripHistory();
    expect(fetchFn).toHaveBeenCalledWith(
      'http://api/transport-orders/trip-history',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });
  it('returns the parsed months with key/title/count/trips', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          months: [
            {
              monthKey: '2026-03',
              label: 'Thg 3 2026',
              count: 2,
              trips: [
                completedRow('A', '2026-03-20T03:00:00.000Z'),
                completedRow('B', '2026-03-02T03:00:00.000Z'),
              ],
            },
            {
              monthKey: '2026-02',
              label: 'Thg 2 2026',
              count: 1,
              trips: [completedRow('C', '2026-02-10T03:00:00.000Z')],
            },
          ],
        }),
    });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      fetchFn: fetchFn as never,
    });
    const months = await client.tripHistory();
    expect(months).toHaveLength(2);
    expect(months[0]?.monthKey).toBe('2026-03');
    expect(months[0]?.label).toBe('Thg 3 2026');
    expect(months[0]?.count).toBe(2);
    expect(months[0]?.trips).toHaveLength(2);
    expect(months[0]?.trips[0]?.orderRef).toBe('A');
    expect(months[1]?.monthKey).toBe('2026-02');
    expect(months[1]?.count).toBe(1);
  });
  it('throws on non-ok HTTP status', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      fetchFn: fetchFn as never,
    });
    await expect(client.tripHistory()).rejects.toThrow(/401/);
  });
  it('rejects when the response is not an object', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      fetchFn: fetchFn as never,
    });
    await expect(client.tripHistory()).rejects.toThrow();
  });
  it('rejects when months is not an array', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ months: 'nope' }) });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      fetchFn: fetchFn as never,
    });
    await expect(client.tripHistory()).rejects.toThrow();
  });
  it('rejects when a month is missing a numeric count', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          months: [{ monthKey: '2026-03', label: 'Thg 3 2026', count: 'two', trips: [] }],
        }),
    });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      fetchFn: fetchFn as never,
    });
    await expect(client.tripHistory()).rejects.toThrow(/count/);
  });
  it('rejects when a month trips field is not an array', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          months: [{ monthKey: '2026-03', label: 'Thg 3 2026', count: 0, trips: 'nope' }],
        }),
    });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => 't',
      fetchFn: fetchFn as never,
    });
    await expect(client.tripHistory()).rejects.toThrow();
  });
  it('awaits an async bearerToken provider', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ months: [] }) });
    const client = new AssignmentsClient({
      apiUrl: 'http://api',
      bearerToken: () => Promise.resolve('async-tok'),
      fetchFn: fetchFn as never,
    });
    await client.tripHistory();
    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer async-tok' }),
      }),
    );
  });
});
