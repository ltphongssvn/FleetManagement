// apps/driver-app/test/completed-query.test.ts
// TDD RED: the pure, React-free pieces of the completed-orders infinite query
// -- the search-keyed cache key, the paging queryFn factory, and the
// getNextPageParam derivation. The useInfiniteQuery hook itself is a thin React
// wrapper (see use-completed-orders.tsx) and, like use-trip-history.tsx, is not
// unit-tested; all testable logic lives here.
//
// Offset infinite scroll (2026): each page carries page/pageSize/total/
// totalPages/hasMore (SSOT DriverCompletedPageResponse). getNextPageParam
// returns the next page number while hasMore is true, and undefined once the
// last page is reached -- which is how useInfiniteQuery knows to stop.
import { describe, it, expect, vi } from 'vitest';
import {
  completedQueryKey,
  makeCompletedQueryFn,
  getCompletedNextPageParam,
  COMPLETED_PAGE_SIZE,
} from '../src/assignments/completed-query.js';
import type { DriverCompletedPageResponse } from '@fleet/sync-protocol';

function pageAt(page: number, hasMore: boolean): DriverCompletedPageResponse {
  return { data: [], page, pageSize: COMPLETED_PAGE_SIZE, total: 99, totalPages: 5, hasMore };
}

describe('completedQueryKey', () => {
  it('is a stable array key with no search term', () => {
    expect(completedQueryKey(undefined)).toEqual(['completed-orders', '']);
  });
  it('includes the search term so a new search is a distinct cache entry', () => {
    expect(completedQueryKey('XTT.06')).toEqual(['completed-orders', 'XTT.06']);
  });
});

describe('makeCompletedQueryFn', () => {
  it('calls client.completed with the pageParam as the page and the shared page size', async () => {
    const completed = vi.fn().mockResolvedValue(pageAt(3, true));
    const queryFn = makeCompletedQueryFn({ completed } as never, undefined);
    const result = await queryFn({ pageParam: 3 });
    expect(completed).toHaveBeenCalledWith({ page: 3, pageSize: COMPLETED_PAGE_SIZE });
    expect(result.page).toBe(3);
  });
  it('passes the search term through to the client when present', async () => {
    const completed = vi.fn().mockResolvedValue(pageAt(1, false));
    const queryFn = makeCompletedQueryFn({ completed } as never, 'XTT.06');
    await queryFn({ pageParam: 1 });
    expect(completed).toHaveBeenCalledWith({ page: 1, pageSize: COMPLETED_PAGE_SIZE, search: 'XTT.06' });
  });
  it('propagates a rejection from the client', async () => {
    const completed = vi.fn().mockRejectedValue(new Error('network'));
    const queryFn = makeCompletedQueryFn({ completed } as never, undefined);
    await expect(queryFn({ pageParam: 1 })).rejects.toThrow('network');
  });
});

describe('getCompletedNextPageParam', () => {
  it('returns the next page number while hasMore is true', () => {
    expect(getCompletedNextPageParam(pageAt(2, true))).toBe(3);
  });
  it('returns undefined once the last page is reached (hasMore false) so paging stops', () => {
    expect(getCompletedNextPageParam(pageAt(5, false))).toBeUndefined();
  });
});
