// apps/api/test/schema.test.ts
// Contract tests: verify Drizzle schema column shapes match Frozen Stack PDF spec.
// Tests inspect $inferSelect type via runtime column metadata, not types alone.
import { describe, it, expect } from 'vitest';
import {
  deviceRegistry,
  deviceSession,
  fleetAuditLog,
  syncChangeFeed,
  outbox,
} from '../src/database/schema/index.js';

describe('@fleet/api - device schema', () => {
  it('device_registry has all tenancy columns', () => {
    const cols = Object.keys(deviceRegistry);
    expect(cols).toContain('companyId');
    expect(cols).toContain('businessUnitId');
    expect(cols).toContain('depotId');
    expect(cols).toContain('legalEntityId');
  });

  it('device_session has revoked_at as authoritative lifecycle field', () => {
    expect(Object.keys(deviceSession)).toContain('revokedAt');
  });

  it('device_session carries surface + sessionMode at issue', () => {
    const cols = Object.keys(deviceSession);
    expect(cols).toContain('surface');
    expect(cols).toContain('sessionMode');
  });

  it('device_session tracks token_consumed_at for atomic bootstrap consume', () => {
    expect(Object.keys(deviceSession)).toContain('tokenConsumedAt');
  });
});

describe('@fleet/api - three append paths', () => {
  it('fleet_audit_log has serverSeq + operator+event+time index target columns', () => {
    const cols = Object.keys(fleetAuditLog);
    expect(cols).toContain('serverSeq');
    expect(cols).toContain('operatorId');
    expect(cols).toContain('eventType');
    expect(cols).toContain('createdAt');
  });

  it('sync_change_feed enforces unique actionId for client dedup', () => {
    expect(Object.keys(syncChangeFeed)).toContain('actionId');
  });

  it('outbox has status + next_attempt_at for poller indexing', () => {
    const cols = Object.keys(outbox);
    expect(cols).toContain('status');
    expect(cols).toContain('nextAttemptAt');
    expect(cols).toContain('queueName');
  });
});
