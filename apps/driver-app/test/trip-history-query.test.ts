// apps/driver-app/test/trip-history-query.test.ts
// TDD RED: the pure, React-free pieces of the trip-history query — the
// stable cache key and the queryFn factory. The useQuery hook itself is a
// thin React wrapper (see use-trip-history.tsx) and, like use-auth.tsx, is
// not unit-tested; all testable logic lives here.
import { describe, it, expect, vi } from 'vitest';
import {
  TRIP_HISTORY_QUERY_KEY,
  makeTripHistoryQueryFn,
} from '../src/assignments/trip-history-query.js';
import type { TripHistoryMonth } from '../src/assignments/assignments-client.js';
describe('TRIP_HISTORY_QUERY_KEY', () => {
  it('is a stable array key for the trip-history cache entry', () => {
    expect(TRIP_HISTORY_QUERY_KEY).toEqual(['trip-history']);
  });
});
describe('makeTripHistoryQueryFn', () => {
  it('returns a function that calls the client tripHistory method', async () => {
    const months: TripHistoryMonth[] = [
      { monthKey: '2026-03', label: 'Thg 3 2026', count: 0, trips: [] },
    ];
    const tripHistory = vi.fn().mockResolvedValue(months);
    const queryFn = makeTripHistoryQueryFn({ tripHistory } as never);
    const result = await queryFn();
    expect(tripHistory).toHaveBeenCalledOnce();
    expect(result).toBe(months);
  });
  it('propagates a rejection from the client', async () => {
    const tripHistory = vi.fn().mockRejectedValue(new Error('network'));
    const queryFn = makeTripHistoryQueryFn({ tripHistory } as never);
    await expect(queryFn()).rejects.toThrow('network');
  });
});
