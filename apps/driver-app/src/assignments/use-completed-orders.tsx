// apps/driver-app/src/assignments/use-completed-orders.tsx
// TanStack useInfiniteQuery hook for the driver's completed-orders archive
// (paginated + searchable). Thin React wrapper: useInfiniteQuery owns the
// pages, loading/error/success, caching, staleness, request dedup, bounded
// retry, cancellation, and the fetchNextPage/hasNextPage machinery that drives
// infinite scroll. The screen just reads pages + calls fetchNextPage.
//
// All testable logic (search-keyed cache key, paging queryFn, getNextPageParam)
// lives in the React-free completed-query.ts. Like use-trip-history.tsx this
// wrapper is excluded from unit-test coverage per the project's React-file
// testing policy.
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { DriverCompletedPageResponse } from '@fleet/sync-protocol';
import { AssignmentsClient } from './assignments-client.js';
import {
  completedQueryKey,
  makeCompletedQueryFn,
  getCompletedNextPageParam,
} from './completed-query.js';
import { getApiUrl } from '../config/api-url.js';
import { useAuth } from '../auth/use-auth.js';

// search: optional free-text filter (order ref / customer name). A new search
// term is a distinct cache entry (see completedQueryKey), so switching search
// starts a fresh paginated fetch rather than mutating the existing pages.
export function useCompletedOrders(
  search: string | undefined,
): UseInfiniteQueryResult<InfiniteData<DriverCompletedPageResponse>> {
  const { getAccessToken, status } = useAuth();
  const client = new AssignmentsClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken });
  return useInfiniteQuery({
    queryKey: completedQueryKey(search),
    queryFn: makeCompletedQueryFn(client, search),
    initialPageParam: 1,
    getNextPageParam: getCompletedNextPageParam,
    // Only fetch once authenticated — before that there is no bearer token.
    enabled: status === 'authenticated',
  });
}
