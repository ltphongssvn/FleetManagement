// apps/driver-app/src/assignments/use-assignments.tsx
// TanStack Query hook for the driver assignment list and its lifecycle
// actions. Replaces the manual useEffect/useState fetch plus the manual
// runAction + refetch the assignments screen used to run inline.
//
// useQuery owns the list's loading/error/success, caching, staleness, retry,
// dedup, and cancellation. useMutation owns the accept/start/complete
// transition: its onSuccess invalidates the list query so the card refetches
// with its new state — the same effect the old manual load() refetch had.
//
// Thin React wrapper; the testable logic (key, queryFn, mutationFn) lives in
// the React-free assignments-query.ts. Excluded from coverage like
// use-auth.tsx per the project's React-file testing policy.
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AssignmentsClient, type AssignmentRow } from './assignments-client.js';
import { DeliveryLifecycleClient, type TransitionResult } from './delivery-lifecycle-client.js';
import {
  ASSIGNMENTS_QUERY_KEY,
  makeAssignmentsQueryFn,
  makeLifecycleMutationFn,
  type LifecycleMutationInput,
} from './assignments-query.js';
import { getApiUrl } from '../config/api-url.js';
import { useAuth } from '../auth/use-auth.js';
export interface UseAssignmentsResult {
  readonly query: UseQueryResult<readonly AssignmentRow[]>;
  readonly lifecycle: UseMutationResult<TransitionResult, Error, LifecycleMutationInput>;
}
export function useAssignments(): UseAssignmentsResult {
  const { getAccessToken, status } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ASSIGNMENTS_QUERY_KEY,
    queryFn: makeAssignmentsQueryFn(
      new AssignmentsClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken }),
    ),
    enabled: status === 'authenticated',
  });
  const lifecycle = useMutation<TransitionResult, Error, LifecycleMutationInput>({
    mutationFn: makeLifecycleMutationFn(
      new DeliveryLifecycleClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken }),
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_QUERY_KEY });
    },
  });
  return { query, lifecycle };
}
