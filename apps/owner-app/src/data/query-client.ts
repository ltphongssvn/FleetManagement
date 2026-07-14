// apps/owner-app/src/data/query-client.ts
// App-wide TanStack Query client factory. The owner operates in Vietnam
// against a Railway US/SG backend, so a bounded retry smooths transient
// network failures; staleTime keeps a revisited screen from hard-refetching
// while still refreshing in the background.
import { QueryClient } from '@tanstack/react-query';
const RETRY_ATTEMPTS = 2;
const STALE_TIME_MS = 60 * 1000; // 1 minute - the glance dashboard wants fresh-ish counts
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
