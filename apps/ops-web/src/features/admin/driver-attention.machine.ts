// apps/ops-web/src/features/admin/driver-attention.machine.ts
// Driver-attention triage machine (XState v5). Models WORKFLOW state only:
// rows are server data, validated ONCE at the HTTP boundary
// (parseAdminDriverRows in the client) and trusted here -- two-axis rule.
// Partition truth is delegated to classifyDriverAttention from
// @fleet/sync-protocol so the contract stays the single classification
// source; this machine adds the finite-state shape the UI keys off:
//   loading -> ready.attention | ready.allClear | error
// Root-level event handlers make LOADED/ERROR/REFRESH legal from ANY state
// (error recovery, focus refetch). The ready decision is the house
// guarded-array-with-default pattern on a transient child: assignPartition
// commits context on the transition, then the always-array picks attention
// vs allClear -- states are explicit, boolean soup is impossible.
import { assertEvent, assign, setup } from 'xstate';
import {
  classifyDriverAttention,
  type AdminDriverRow,
  type DriverAttentionReason,
} from '@fleet/sync-protocol';

/** One queue entry: the trusted row plus its machine-readable reasons. */
export interface DriverAttentionEntry {
  readonly row: AdminDriverRow;
  readonly reasons: readonly DriverAttentionReason[];
}

export interface DriverAttentionContext {
  readonly attention: readonly DriverAttentionEntry[];
  readonly configured: readonly AdminDriverRow[];
  readonly errorMessage: string | null;
}

export type DriverAttentionEvent =
  | { type: 'LOADED'; rows: readonly AdminDriverRow[] }
  | { type: 'ERROR'; message: string }
  | { type: 'REFRESH' };

const EMPTY_ATTENTION: readonly DriverAttentionEntry[] = [];
const EMPTY_CONFIGURED: readonly AdminDriverRow[] = [];

/** Pure partition over trusted rows, contract order preserved. */
function partitionRows(rows: readonly AdminDriverRow[]): {
  attention: readonly DriverAttentionEntry[];
  configured: readonly AdminDriverRow[];
} {
  const attention: DriverAttentionEntry[] = [];
  const configured: AdminDriverRow[] = [];
  for (const row of rows) {
    const reasons = classifyDriverAttention(row);
    if (reasons.length > 0) {
      attention.push({ row, reasons });
    } else {
      configured.push(row);
    }
  }
  return { attention, configured };
}

export const driverAttentionMachine = setup({
  types: {
    context: {} as DriverAttentionContext,
    events: {} as DriverAttentionEvent,
  },
  guards: {
    hasAttention: ({ context }) => context.attention.length > 0,
  },
  actions: {
    assignPartition: assign(({ event }) => {
      assertEvent(event, 'LOADED');
      return { ...partitionRows(event.rows), errorMessage: null };
    }),
    assignError: assign(({ event }) => {
      assertEvent(event, 'ERROR');
      return { errorMessage: event.message };
    }),
    resetForReload: assign(() => ({
      attention: EMPTY_ATTENTION,
      configured: EMPTY_CONFIGURED,
      errorMessage: null,
    })),
  },
}).createMachine({
  id: 'driverAttention',
  context: {
    attention: EMPTY_ATTENTION,
    configured: EMPTY_CONFIGURED,
    errorMessage: null,
  },
  initial: 'loading',
  on: {
    LOADED: { target: '.ready', actions: 'assignPartition' },
    ERROR: { target: '.error', actions: 'assignError' },
    REFRESH: { target: '.loading', actions: 'resetForReload' },
  },
  states: {
    loading: {},
    ready: {
      initial: 'deciding',
      states: {
        deciding: {
          always: [
            { guard: 'hasAttention', target: 'attention' },
            { target: 'allClear' },
          ],
        },
        attention: {},
        allClear: {},
      },
    },
    error: {},
  },
});
