// apps/driver-app/app/_layout.tsx
// Root layout: initialize Sentry + SQLite migrations + sync loop scheduler.
// PDF Day-One #2 + #4 + #6: SQLite migrations on boot; sync loop event-driven
// (timer + push wake + network online).
import { useEffect, useRef, type JSX } from 'react';
import { Stack } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import * as SQLite from 'expo-sqlite';
import { initSentry } from '../src/observability/sentry-bootstrap.js';
import { runMigrations } from '../src/storage/migrate.js';
import { SqliteSyncStore } from '../src/storage/sqlite-sync-store.js';
import { FetchSyncTransport } from '../src/sync/fetch-sync-transport.js';
import { runSyncOnce } from '../src/sync/sync-loop.js';
import { decideSyncSchedule, SYNC_IDLE_INTERVAL_MS } from '../src/index.js';
import type { SyncSchedulerState, SyncSchedulerOutcome } from '../src/index.js';

const DB_NAME = 'fleet-driver.db';

function RootLayout(): JSX.Element {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const dsnRaw: unknown = process.env['EXPO_PUBLIC_SENTRY_DSN'];
    initSentry(typeof dsnRaw === 'string' ? dsnRaw : undefined);

    const apiUrlRaw: unknown = process.env['EXPO_PUBLIC_FLEET_API_URL'];
    if (typeof apiUrlRaw !== 'string' || apiUrlRaw.length === 0) return;
    const apiUrl: string = apiUrlRaw;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const state: SyncSchedulerState = {
      online: true,
      appActive: true,
      lastSyncAtMs: null,
      lastOutcome: null,
      consecutiveTransportFailures: 0,
    };

    const bootstrap = async (): Promise<void> => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await runMigrations(db);
      const store = new SqliteSyncStore(db);
      const transport = new FetchSyncTransport({
        apiUrl,
        bearerToken: (): string => {
          const t: unknown = process.env['EXPO_PUBLIC_FLEET_API_TOKEN'];
          return typeof t === 'string' ? t : '';
        },
      });

      const tick = async (): Promise<void> => {
        if (stopped) return;
        const decision = decideSyncSchedule(state, 'timer_tick', Date.now());
        if (decision.action === 'run_now') {
          const outcome = await runSyncOnce(transport, store);
          (state as { lastSyncAtMs: number }).lastSyncAtMs = Date.now();
          (state as { lastOutcome: SyncSchedulerOutcome }).lastOutcome =
            outcome.kind === 'transport_failure' ? 'last_transport_failure' :
            outcome.kind === 'applied' ? 'last_applied' :
            outcome.kind === 'idle' ? 'last_idle' :
            outcome.kind === 'cursor_expired_recovered' ? 'last_cursor_expired_recovered' :
            outcome.kind === 'protocol_violation' ? 'last_protocol_violation' :
            'last_storage_failure';
          (state as { consecutiveTransportFailures: number }).consecutiveTransportFailures =
            outcome.kind === 'transport_failure' ? state.consecutiveTransportFailures + 1 : 0;
        }
        timer = setTimeout(() => { void tick(); }, SYNC_IDLE_INTERVAL_MS);
      };
      timer = setTimeout(() => { void tick(); }, SYNC_IDLE_INTERVAL_MS);
    };
    void bootstrap().catch((err: unknown) => {
      Sentry.captureException(err);
    });

    return (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return <Stack />;
}

export default Sentry.wrap(RootLayout);
