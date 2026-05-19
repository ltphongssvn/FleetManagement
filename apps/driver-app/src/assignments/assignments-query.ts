// apps/driver-app/src/assignments/assignments-query.ts
// Pure, React-free configuration for the assignments TanStack Query: the
// cache key, the list queryFn factory, and the lifecycle mutation factory
// (accept / start / complete). Kept separate from the useAssignments hook so
// this logic has no React dependency and is covered by ordinary unit tests,
// while the hook stays a thin wrapper.
import type { AssignmentsClient, AssignmentRow } from './assignments-client.js';
import type { DeliveryLifecycleClient, TransitionResult } from './delivery-lifecycle-client.js';
// Stable cache key for the driver's assignment list. After a lifecycle
// mutation the hook invalidates this key so the list refetches.
export const ASSIGNMENTS_QUERY_KEY = ['assignments'] as const;
// The three non-terminal driver lifecycle transitions.
export type LifecycleKind = 'accept' | 'start' | 'complete';
// Mutation input: which road run, which transition.
export interface LifecycleMutationInput {
  readonly roadRunId: string;
  readonly kind: LifecycleKind;
}
// Minimal slices of the clients the factories need — trivially mockable.
export interface AssignmentsListSource {
  list(): Promise<readonly AssignmentRow[]>;
}
export interface LifecycleSource {
  accept(roadRunId: string): Promise<TransitionResult>;
  start(roadRunId: string): Promise<TransitionResult>;
  complete(roadRunId: string): Promise<TransitionResult>;
}
// Builds the queryFn TanStack Query calls to fetch and cache the list.
export function makeAssignmentsQueryFn(
  client: AssignmentsListSource | AssignmentsClient,
): () => Promise<readonly AssignmentRow[]> {
  return () => client.list();
}
// Builds the mutationFn TanStack Query calls for a lifecycle transition.
// Dispatches to the matching client method by kind.
export function makeLifecycleMutationFn(
  client: LifecycleSource | DeliveryLifecycleClient,
): (input: LifecycleMutationInput) => Promise<TransitionResult> {
  return ({ roadRunId, kind }) => {
    if (kind === 'accept') return client.accept(roadRunId);
    if (kind === 'start') return client.start(roadRunId);
    return client.complete(roadRunId);
  };
}
