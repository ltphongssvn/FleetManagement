// apps/driver-app/src/storage/native-bootstrap.ts
// Native-only sync bootstrap. Resolved on iOS/Android via Metro platform extensions.
// Imports name the sibling module directly rather than routing through the
// package barrel. This file already did it BOTH ways: the dynamic imports
// below name modules directly while these two went through the barrel, so the
// correct style was already present one screen down. Importing the barrel from
// inside the package it belongs to is a cycle by construction -- the barrel
// re-exports this module's own siblings.
import {
  decideSyncSchedule,
  SYNC_IDLE_INTERVAL_MS,
  type SyncSchedulerState,
  type SyncSchedulerOutcome,
} from '../sync/sync-scheduler-policy.js';

export interface NativeBootstrapConfig {
  readonly apiUrl: string;
  readonly dbName: string;
  readonly bearerToken: () => string | Promise<string>;
}

export async function startNativeSyncLoop(cfg: NativeBootstrapConfig): Promise<() => void> {
  const SQLite = await import('expo-sqlite');
  const { runMigrations } = await import('./migrate.js');
  const { SqliteSyncStore } = await import('./sqlite-sync-store.js');
  const { FetchSyncTransport } = await import('../sync/fetch-sync-transport.js');
  const { runSyncOnce } = await import('../sync/sync-loop.js');

  const db = await SQLite.openDatabaseAsync(cfg.dbName);
  await runMigrations(db);
  const store = new SqliteSyncStore(db);
  const transport = new FetchSyncTransport({ apiUrl: cfg.apiUrl, bearerToken: cfg.bearerToken });

  const state: SyncSchedulerState = {
    online: true,
    appActive: true,
    lastSyncAtMs: null,
    lastOutcome: null,
    consecutiveTransportFailures: 0,
  };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    const decision = decideSyncSchedule(state, 'timer_tick', Date.now());
    if (decision.action === 'run_now') {
      const outcome = await runSyncOnce(transport, store);
      (state as { lastSyncAtMs: number }).lastSyncAtMs = Date.now();
      (state as { lastOutcome: SyncSchedulerOutcome }).lastOutcome =
        outcome.kind === 'transport_failure'
          ? 'last_transport_failure'
          : outcome.kind === 'applied'
            ? 'last_applied'
            : outcome.kind === 'idle'
              ? 'last_idle'
              : outcome.kind === 'cursor_expired_recovered'
                ? 'last_cursor_expired_recovered'
                : outcome.kind === 'protocol_violation'
                  ? 'last_protocol_violation'
                  : 'last_storage_failure';
      (state as { consecutiveTransportFailures: number }).consecutiveTransportFailures =
        outcome.kind === 'transport_failure' ? state.consecutiveTransportFailures + 1 : 0;
    }
    timer = setTimeout(() => {
      void tick();
    }, SYNC_IDLE_INTERVAL_MS);
  };
  timer = setTimeout(() => {
    void tick();
  }, SYNC_IDLE_INTERVAL_MS);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
