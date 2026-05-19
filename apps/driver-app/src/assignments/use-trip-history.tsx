// apps/driver-app/src/assignments/use-trip-history.tsx
// TanStack Query hook for the driver's monthly trip history. Replaces the
// manual useEffect/useState/void-promise fetch the history screen used to
// run inline: useQuery owns the loading/error/success states, caching,
// staleness, request dedup, bounded retry, and cancellation of outdated
// fetches. The screen just reads the result.
//
// This is a thin React wrapper with no logic of its own — the testable
// pieces (cache key, queryFn) live in the React-free trip-history-query.ts.
// Like use-auth.tsx it is excluded from unit-test coverage per the project's
// React-file testing policy.
import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { AssignmentsClient, type TripHistoryMonth } from './assignments-client.js';
import { TRIP_HISTORY_QUERY_KEY, makeTripHistoryQueryFn } from './trip-history-query.js';
import { getApiUrl } from '../config/api-url.js';
import { useAuth } from '../auth/use-auth.js';
export function useTripHistory(): UseQueryResult<readonly TripHistoryMonth[]> {
  const { getAccessToken, status } = useAuth();
  return useQuery({
    queryKey: TRIP_HISTORY_QUERY_KEY,
    queryFn: makeTripHistoryQueryFn(
      new AssignmentsClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken }),
    ),
    // Only fetch once the driver is authenticated — before that there is no
    // bearer token to send.
    enabled: status === 'authenticated',
  });
}
