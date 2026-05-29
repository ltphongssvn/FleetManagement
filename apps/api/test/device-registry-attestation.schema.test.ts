// apps/api/test/device-registry-attestation.schema.test.ts
// RED: device_registry must carry attestation state so we can gate sensitive ops on
// a device that has proven its integrity within an acceptable freshness window.
import { describe, it, expect } from 'vitest';
import { deviceRegistry } from '../src/database/schema/device.js';
import { getTableConfig } from 'drizzle-orm/pg-core';

describe('device_registry attestation columns', () => {
  const cfg = getTableConfig(deviceRegistry);
  const colNames = (): string[] => cfg.columns.map((c) => c.name);

  it('has attestation_platform varchar nullable (android | ios | null until first attest)', () => {
    expect(colNames()).toContain('attestation_platform');
    const c = cfg.columns.find((x) => x.name === 'attestation_platform');
    expect(c?.notNull).toBe(false);
  });

  it('has attestation_verified_at timestamp nullable', () => {
    expect(colNames()).toContain('attestation_verified_at');
    const c = cfg.columns.find((x) => x.name === 'attestation_verified_at');
    expect(c?.notNull).toBe(false);
  });

  it('has attestation_token_hash varchar nullable (sha256 of last accepted token, for audit)', () => {
    expect(colNames()).toContain('attestation_token_hash');
    const c = cfg.columns.find((x) => x.name === 'attestation_token_hash');
    expect(c?.notNull).toBe(false);
  });
});
