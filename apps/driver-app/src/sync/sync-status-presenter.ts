// apps/driver-app/src/sync/sync-status-presenter.ts
// Pure presenter: scheduler state -> UI status text. Lets the React
// screen render correctly without containing any decision logic.
import { SYNC_CIRCUIT_BREAKER_THRESHOLD, type SyncSchedulerState } from './sync-scheduler-policy.js';

export const SYNC_STATUS_PRESENTER_VERSION = 'sync-status-v1' as const;
/** Below this age, status reads 'Just synced' instead of '<n>m ago'. */
export const SYNC_RECENT_THRESHOLD_MS = 60_000;

export type SyncStatusKind =
  | 'idle'
  | 'offline'
  | 'app_inactive'
  | 'backoff'
  | 'circuit_open'
  | 'never_synced';

export interface SyncStatusView {
  readonly kind: SyncStatusKind;
  readonly label: string;
  readonly secondary: string;
}

export function presentSyncStatus(state: SyncSchedulerState, nowMs: number): SyncStatusView {
  if (!state.online) {
    return { kind: 'offline', label: 'Offline', secondary: 'Will sync when connection returns' };
  }
  if (!state.appActive) {
    return { kind: 'app_inactive', label: 'Paused', secondary: 'Open the app to sync' };
  }
  if (state.lastOutcome === 'last_transport_failure' && state.consecutiveTransportFailures >= SYNC_CIRCUIT_BREAKER_THRESHOLD) {
    return { kind: 'circuit_open', label: 'Sync paused', secondary: `${String(state.consecutiveTransportFailures)} failed attempts` };
  }
  if (state.lastOutcome === 'last_transport_failure') {
    return { kind: 'backoff', label: 'Retrying...', secondary: `Attempt ${String(state.consecutiveTransportFailures + 1)}` };
  }
  if (state.lastSyncAtMs === null) {
    return { kind: 'never_synced', label: 'Not yet synced', secondary: 'Sync will start automatically' };
  }
  const sinceMs = nowMs - state.lastSyncAtMs;
  if (sinceMs < SYNC_RECENT_THRESHOLD_MS) {
    return { kind: 'idle', label: 'All caught up', secondary: 'Just synced' };
  }
  return { kind: 'idle', label: 'All caught up', secondary: `Synced ${formatRelative(sinceMs)} ago` };
}

function formatRelative(ms: number): string {
  const minutes = Math.floor(ms / SYNC_RECENT_THRESHOLD_MS);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d`;
}
