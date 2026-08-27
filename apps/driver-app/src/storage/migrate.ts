// apps/driver-app/src/storage/migrate.ts
// Create the local SQLite schema at app startup.
//
// WHAT THIS IS, STATED HONESTLY (2026-08-19). The previous header claimed
// "Uses expo-sqlite migrations API + drizzle" and it used NEITHER: it exec'd
// hand-written CREATE TABLE IF NOT EXISTS strings. Prose that describes a
// mechanism the file does not have is worse than no comment, because it stops
// anyone looking.
//
// THE REAL LIMITATION, and it is a shipped one. CREATE TABLE IF NOT EXISTS
// creates tables on a FRESH install and silently does nothing on an existing
// one. Every driver phone holds its own isolated database, so the day a column
// is added to schema.ts, existing installs keep the old table and queries fail
// against a column that is not there -- offline, on a phone, with no recovery
// path. Drizzle's Expo guidance is explicit that migrations must be GENERATED
// by drizzle-kit and BUNDLED into the app, and 2026 guidance states the
// failure plainly: ship a changed schema without migrations and existing users
// crash.
//
// NONE of that pipeline exists here: no drizzle.config.ts, no drizzle/ folder,
// no .sql files, no migrate()/useMigrations call, no .sql in Metro sourceExts,
// and no babel.config.js at all for the inline-import plugin. drizzle-kit is
// declared as a devDependency of this app and does nothing. Building it is a
// device-verified arc of its own -- it touches the Metro and Babel configs that
// mobile-native-bundle-config.test.ts deliberately pins -- so it is NOT done
// here rather than half-done inside a hygiene change.
//
// WHAT *IS* FIXED HERE is the duplication that made drift silent. The status
// vocabulary is now imported from schema.ts, the single definition, instead of
// being restated as a literal in the SQL below. Adding a member there now
// flows into this CHECK automatically. The column lists are still written
// twice, which drizzle-kit would eliminate; until it exists,
// storage-schema-drift.guard.test.ts asserts the two agree, so the divergence
// fails a test instead of reaching a driver.
import type * as SQLite from 'expo-sqlite';
import { ACTION_STATUSES } from './schema.js';

// DERIVED from the schema SSOT, never restated. A new status becomes a new
// accepted value here with no second edit.
const STATUS_CHECK = ACTION_STATUSES.map((s) => "'" + s + "'").join(',');

const CREATE_LOCAL_ACTION_LOG = `
CREATE TABLE IF NOT EXISTS local_action_log (
  action_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (${STATUS_CHECK})),
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

/** Exported for the drift guard: the DDL the app actually applies. */
export const STARTUP_DDL = Object.freeze([
  CREATE_LOCAL_ACTION_LOG,
  CREATE_LOCAL_ACTION_LOG_IDX,
  CREATE_SYNC_CURSOR,
]);

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_LOCAL_ACTION_LOG);
  await db.execAsync(CREATE_LOCAL_ACTION_LOG_IDX);
  await db.execAsync(CREATE_SYNC_CURSOR);
}
