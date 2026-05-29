// apps/driver-app/src/assignments/trip-history-query.ts
// Pure, React-free configuration for the trip-history TanStack Query: the
// stable cache key and a queryFn factory. Kept separate from the
// useTripHistory hook so the testable logic (key + fetch closure) has no
// React dependency and is covered by ordinary unit tests, while the hook
// stays a thin wrapper.
import type { AssignmentsClient, TripHistoryMonth } from './assignments-client.js';
// Stable cache key for the driver's monthly trip history. A single entry per
// driver session — the auth token scopes the request server-side.
export const TRIP_HISTORY_QUERY_KEY = ['trip-history'] as const;
// Minimal slice of AssignmentsClient the queryFn needs — keeps the factory
// trivially mockable in tests.
export interface TripHistorySource {
  tripHistory(): Promise<readonly TripHistoryMonth[]>;
}
// Builds the queryFn TanStack Query calls to fetch and cache trip history.
export function makeTripHistoryQueryFn(
  client: TripHistorySource | AssignmentsClient,
): () => Promise<readonly TripHistoryMonth[]> {
  return () => client.tripHistory();
}
