// apps/driver-app/src/storage/sqlite-sync-store.web.ts
// Web stub: SqliteSyncStore is native-only. Web bundle skips it via Platform check.
export interface SqliteSyncStore {
  readonly _native: true;
}
export function createSqliteSyncStore(_db: unknown): SqliteSyncStore {
  throw new Error('SqliteSyncStore is not available on web');
}
