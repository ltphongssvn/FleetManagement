// apps/api/test/device-binding.schema.test.ts
// RED spec (device-binding arc, Phase 3): hardware device binding storage.
// device_registry gains a per-platform stable installation identity
// (installation_id -- Android SSAID / iOS IDFV; CORRELATION key only, never
// proof) and a TOFU binding lifecycle (binding_status pending/active/revoked
// with revoked_at/revoked_reason recorded, never deleted). Cryptographic
// trust lives in the attested-key columns (attestation_key_id, public key
// SPKI, security level, environment, counter for iOS assertion monotonicity).
// device_attestation_event is the append-only audit trail of every
// attestation verification outcome (the table IS the audit trail; rows are
// never updated or deleted), matching the driver_refresh_token pattern.
import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { deviceRegistry } from '../src/database/schema/device.js';
import { deviceAttestationEvent } from '../src/database/schema/device-binding.js';

describe('deviceRegistry binding extensions', () => {
  const cols = getTableColumns(deviceRegistry);
  it('carries the per-platform installation identity (correlation key, nullable until first enroll)', () => {
    expect(cols.installationId).toBeDefined();
    expect(cols.installationId.notNull).toBe(false);
  });
  it('carries the TOFU binding lifecycle with a safe default', () => {
    expect(cols.bindingStatus).toBeDefined();
    expect(cols.bindingStatus.notNull).toBe(true);
    expect(cols.bindingStatus.hasDefault).toBe(true);
  });
  it('records revocation, never deletes (append-only lifecycle columns)', () => {
    expect(cols.bindingRevokedAt).toBeDefined();
    expect(cols.bindingRevokedAt.notNull).toBe(false);
    expect(cols.bindingRevokedReason).toBeDefined();
    expect(cols.bindingRevokedReason.notNull).toBe(false);
  });
  it('stores the attested hardware key material, not any raw secret', () => {
    expect(cols.attestationKeyId).toBeDefined();
    expect(cols.attestationKeyId.notNull).toBe(false);
    expect(cols.attestationPublicKeySpki).toBeDefined();
    expect(cols.attestationSecurityLevel).toBeDefined();
    expect(cols.attestationEnvironment).toBeDefined();
    expect(cols.attestationCounter).toBeDefined();
    const names = Object.keys(cols);
    expect(names).not.toContain('attestationPrivateKey');
    expect(names).not.toContain('rawAttestationToken');
  });
});

describe('deviceAttestationEvent schema (append-only audit trail)', () => {
  const cols = getTableColumns(deviceAttestationEvent);
  it('maps to the device_attestation_event table', () => {
    expect(getTableName(deviceAttestationEvent)).toBe('device_attestation_event');
  });
  it('binds every event to a device, operator and tenancy', () => {
    expect(cols.deviceId).toBeDefined();
    expect(cols.deviceId.notNull).toBe(true);
    expect(cols.operatorId).toBeDefined();
    expect(cols.operatorId.notNull).toBe(true);
    expect(cols.companyId).toBeDefined();
  });
  it('records the verification outcome and platform, required at insert', () => {
    expect(cols.platform).toBeDefined();
    expect(cols.platform.notNull).toBe(true);
    expect(cols.outcome).toBeDefined();
    expect(cols.outcome.notNull).toBe(true);
    expect(cols.securityLevel).toBeDefined();
    expect(cols.securityLevel.notNull).toBe(false);
  });
  it('stores only a sha-256 hex hash of the platform token, never the raw token', () => {
    expect(cols.tokenHash).toBeDefined();
    const names = Object.keys(cols);
    expect(names).not.toContain('token');
    expect(names).not.toContain('rawToken');
  });
  it('is append-only: created timestamp required, no updated/deleted columns', () => {
    expect(cols.createdAt).toBeDefined();
    expect(cols.createdAt.notNull).toBe(true);
    const names = Object.keys(cols);
    expect(names).not.toContain('updatedAt');
    expect(names).not.toContain('deletedAt');
  });
});
