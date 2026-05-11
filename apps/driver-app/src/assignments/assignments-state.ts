// apps/driver-app/src/assignments/assignments-state.ts
// Pure state machine for assignments screen. UI-framework agnostic.
import type { AssignmentRow } from './assignments-client.js';

export type AssignmentsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'loaded'; readonly rows: readonly AssignmentRow[] }
  | { readonly kind: 'error'; readonly message: string };

export interface AssignmentsClientLike {
  list(): Promise<readonly AssignmentRow[]>;
}

export async function fetchAssignmentsState(client: AssignmentsClientLike): Promise<AssignmentsState> {
  try {
    const rows = await client.list();
    if (rows.length === 0) return { kind: 'empty' };
    return { kind: 'loaded', rows };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}
