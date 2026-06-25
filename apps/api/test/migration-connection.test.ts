// apps/api/test/migration-connection.test.ts
// Unit test for the migration-vs-runtime connection selection (Layer-1).
//
// 2026 least-privilege pattern: the RUNTIME app connects as a restricted role
// (no DDL, no DELETE), while MIGRATIONS need an elevated DDL-capable role. The app
// therefore selects a SEPARATE migration connection string when one is provided,
// falling back to DATABASE_URL so existing single-credential environments are
// unaffected. This pins that selection logic.
import { describe, it, expect } from 'vitest';
import { selectMigrationConnectionString } from '../src/database/migration-connection.js';

describe('@fleet/api - selectMigrationConnectionString', () => {
  it('returns MIGRATION_DATABASE_URL when it is set', () => {
    const env = { MIGRATION_DATABASE_URL: 'postgres://migrator@host/db', DATABASE_URL: 'postgres://app@host/db' };
    expect(selectMigrationConnectionString(env)).toBe('postgres://migrator@host/db');
  });

  it('falls back to DATABASE_URL when MIGRATION_DATABASE_URL is unset', () => {
    const env = { DATABASE_URL: 'postgres://app@host/db' };
    expect(selectMigrationConnectionString(env)).toBe('postgres://app@host/db');
  });

  it('falls back to DATABASE_URL when MIGRATION_DATABASE_URL is empty string', () => {
    const env = { MIGRATION_DATABASE_URL: '', DATABASE_URL: 'postgres://app@host/db' };
    expect(selectMigrationConnectionString(env)).toBe('postgres://app@host/db');
  });

  it('throws when neither url is set', () => {
    expect(() => selectMigrationConnectionString({})).toThrow();
  });

  it('throws when both are empty strings', () => {
    expect(() => selectMigrationConnectionString({ MIGRATION_DATABASE_URL: '', DATABASE_URL: '' })).toThrow();
  });
});
