// apps/driver-app/src/assignments/completed-query.ts
// Pure, React-free configuration for the completed-orders infinite query: the
// search-keyed cache key, the paging queryFn factory, and the getNextPageParam
// derivation. Kept separate from the useCompletedOrders hook so this logic has
// no React dependency and is covered by ordinary unit tests, while the hook
// stays a thin useInfiniteQuery wrapper.
//
// Offset infinite scroll (2026): pages carry the SSOT DriverCompletedPageResponse
// envelope (page/pageSize/total/totalPages/hasMore). getNextPageParam returns the
// next page number while hasMore is true and undefined once the last page is
// reached, which is how useInfiniteQuery knows to stop fetching.
import { ROAD_RUN_PAGE_SIZE_DEFAULT } from '@fleet/sync-protocol';
import type { DriverCompletedPageResponse } from '@fleet/sync-protocol';

// Minimal slice of AssignmentsClient the queryFn needs -- trivially mockable.
export interface CompletedSource {
  completed(query: { page: number; pageSize: number; search?: string }): Promise<DriverCompletedPageResponse>;
}

// Shared page size for the driver completed archive (the SSOT board default).
export const COMPLETED_PAGE_SIZE = ROAD_RUN_PAGE_SIZE_DEFAULT;

// Stable cache key, namespaced by the search term so a new search is a distinct
// infinite-query cache entry (empty string when no search is active).
export function completedQueryKey(search: string | undefined): readonly [string, string] {
  return ['completed-orders', search ?? ''];
}

// Builds the infinite-query queryFn: fetch the page at pageParam, carrying the
// optional search term. Page size is the shared constant so every page request
// is uniform.
export function makeCompletedQueryFn(
  client: CompletedSource,
  search: string | undefined,
): (ctx: { pageParam: number }) => Promise<DriverCompletedPageResponse> {
  return ({ pageParam }) =>
    client.completed({
      page: pageParam,
      pageSize: COMPLETED_PAGE_SIZE,
      ...(search !== undefined ? { search } : {}),
    });
}

// getNextPageParam for useInfiniteQuery: the next page number while more pages
// remain, or undefined once hasMore is false so paging stops.
export function getCompletedNextPageParam(lastPage: DriverCompletedPageResponse): number | undefined {
  return lastPage.hasMore ? lastPage.page + 1 : undefined;
}
