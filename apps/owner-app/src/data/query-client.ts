// apps/owner-app/src/data/query-client.ts
// App-wide TanStack Query client factory. The owner operates in Vietnam
// against a Railway US/SG backend, so a bounded retry smooths transient
// network failures; staleTime keeps a revisited screen from hard-refetching
// while still refreshing in the background.
//
// THE CONSTANTS LIVE INSIDE THE FUNCTION, deliberately. As module-level consts
// they produced STATIC MUTANTS: the expression is evaluated once at import,
// before any test activates a mutant, so Stryker reported
// `60 * 1000` -> `60 / 1000` as SURVIVED even with a test asserting
// staleTime === 60_000. Stryker warns about this class directly ("Detected 11
// static mutants") and its own guidance for them is to rewrite the code so the
// situation does not arise, because no test can kill a value that was frozen
// before the test ran.
//
// Evaluated per call, the same expressions are ordinary mutants and the
// assertions in query-client.test.ts + mutation-gaps.test.ts kill them. The
// values are still named, so the intent a bare 60000 would hide is preserved.
import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  const RETRY_ATTEMPTS = 2;
  // 1 minute - the glance dashboard wants fresh-ish counts.
  const STALE_TIME_MS = 60 * 1000;
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: RETRY_ATTEMPTS,
        staleTime: STALE_TIME_MS,
      },
    },
  });
}
