// apps/owner-app/src/dashboard/use-adoption.tsx
// TanStack Query hook wrapping fetchAdoptionMetrics: delegates loading/error/
// retry/refetch to react-query. The screen pulls-to-refresh via refetch().
// Excluded from unit coverage (react hook over native fetch); the underlying
// fetchAdoptionMetrics and presenter are unit-tested, and this is exercised in
// the manual UI step.
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { OwnerAdoptionMetrics } from '@fleet/sync-protocol';
import { fetchAdoptionMetrics } from './adoption-client.js';
import { getApiUrl } from '../config/api-url.js';
import { useAuth } from '../auth/use-auth.js';

export function useAdoption(): UseQueryResult<OwnerAdoptionMetrics> {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ['owner', 'adoption'],
    queryFn: () => fetchAdoptionMetrics({ apiUrl: getApiUrl(), bearerToken: getAccessToken }),
  });
}
