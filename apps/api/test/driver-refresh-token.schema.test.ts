// apps/api/test/driver-refresh-token.schema.test.ts
// RED spec (driver-app-security arc, Phase 3.1): driver_refresh_token table.
// RFC 9700 rotating-refresh storage: hash-at-rest (never the raw token),
// family id for reuse-detection revocation, append-only lifecycle columns
// (revoked_at / revoked_reason / replaced_by_token_hash record state changes;
// rows are never deleted -- the table IS the audit trail).
import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { driverRefreshToken } from '../src/database/schema/driver-refresh-token.js';

describe('driverRefreshToken schema', () => {
  const cols = getTableColumns(driverRefreshToken);

  it('maps to the driver_refresh_token table', () => {
    expect(getTableName(driverRefreshToken)).toBe('driver_refresh_token');
  });

  it('stores only a sha-256 hex hash of the token, never the raw token', () => {
    expect(cols.tokenHash).toBeDefined();
    expect(cols.tokenHash.notNull).toBe(true);
    const names = Object.keys(cols);
    expect(names).not.toContain('token');
    expect(names).not.toContain('rawToken');
  });

  it('carries the rotation family id for reuse-detection revocation', () => {
    expect(cols.familyId).toBeDefined();
    expect(cols.familyId.notNull).toBe(true);
  });

  it('binds each token to a driver and to tenancy', () => {
    expect(cols.driverId).toBeDefined();
    expect(cols.driverId.notNull).toBe(true);
    expect(cols.companyId).toBeDefined();
    expect(cols.operatorId).toBeDefined();
    expect(cols.operatorId.notNull).toBe(true);
  });

  it('has an append-only lifecycle: issued/expires required, revocation recorded not deleted', () => {
    expect(cols.issuedAt.notNull).toBe(true);
    expect(cols.expiresAt.notNull).toBe(true);
    expect(cols.revokedAt.notNull).toBe(false);
    expect(cols.revokedReason.notNull).toBe(false);
    expect(cols.replacedByTokenHash.notNull).toBe(false);
  });
});
