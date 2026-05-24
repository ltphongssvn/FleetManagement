// apps/driver-app/src/data/query-client.ts
// App-wide TanStack Query client factory. createQueryClient returns a fresh
// QueryClient with the driver-app defaults so server-data screens delegate
// fetch lifecycle (loading, error, retry, caching, staleness, dedup,
// cancellation) to TanStack Query instead of hand-rolling useEffect/useState.
//
// Drivers operate in Vietnam against a Railway US/SG backend, so transient
// network failures are expected: a bounded retry smooths those over without
// looping forever. staleTime keeps a screen revisited within the window from
// hard-refetching, while the data still refreshes in the background.
import { QueryClient } from '@tanstack/react-query';
const RETRY_ATTEMPTS = 2;
const STALE_TIME_MS = 5 * 60 * 1000; // 5 minutes
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: RETRY_ATTEMPTS,
        staleTime: STALE_TIME_MS,
      },
    },
  });
}
