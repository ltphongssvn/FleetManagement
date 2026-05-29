// apps/driver-app/src/storage/migrate.ts
// Apply schema at app startup. Uses expo-sqlite migrations API + drizzle.
import type * as SQLite from 'expo-sqlite';

const CREATE_LOCAL_ACTION_LOG = `
CREATE TABLE IF NOT EXISTS local_action_log (
  action_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','syncing','synced','rejected','superseded')),
  blocked_by_action_id TEXT,
  created_at INTEGER NOT NULL,
  synced_at INTEGER,
  CHECK (sequence > 0)
);`;

const CREATE_LOCAL_ACTION_LOG_IDX = `
CREATE UNIQUE INDEX IF NOT EXISTS local_action_log_aggregate_sequence_uq
  ON local_action_log (aggregate_type, aggregate_id, sequence);`;

const CREATE_SYNC_CURSOR = `
CREATE TABLE IF NOT EXISTS sync_cursor (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor TEXT NOT NULL,
  last_seen_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);`;

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_LOCAL_ACTION_LOG);
  await db.execAsync(CREATE_LOCAL_ACTION_LOG_IDX);
  await db.execAsync(CREATE_SYNC_CURSOR);
}
