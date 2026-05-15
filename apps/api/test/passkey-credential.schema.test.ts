// apps/api/test/passkey-credential.schema.test.ts
// RED: passkey_credential table schema with FK to device_registry.
// WebAuthn spec requires storing: credential_id (globally unique), public_key (COSE),
// sign_count (monotonic counter), aaguid (authenticator model), transports.
// Tenancy columns inherited per Frozen Stack tenancy convention.
import { describe, it, expect } from 'vitest';
import { passkeyCredential } from '../src/database/schema/passkey-credential.js';
import { getTableConfig } from 'drizzle-orm/pg-core';

describe('passkey_credential schema', () => {
  const cfg = getTableConfig(passkeyCredential);

  it('table is named passkey_credential', () => {
    expect(cfg.name).toBe('passkey_credential');
  });

  const colNames = (): string[] => cfg.columns.map((c) => c.name);

  it('has primary key passkey_credential_id (uuid)', () => {
    expect(colNames()).toContain('passkey_credential_id');
    const c = cfg.columns.find((x) => x.name === 'passkey_credential_id');
    expect(c?.primary).toBe(true);
  });

  it('has credential_id bytea (raw WebAuthn credential id, globally unique)', () => {
    expect(colNames()).toContain('credential_id');
  });

  it('has public_key bytea (COSE-encoded)', () => {
    expect(colNames()).toContain('public_key');
  });

  it('has sign_count bigint not null default 0', () => {
    const c = cfg.columns.find((x) => x.name === 'sign_count');
    expect(c).toBeDefined();
    expect(c?.notNull).toBe(true);
  });

  it('has aaguid uuid (authenticator model identifier)', () => {
    expect(colNames()).toContain('aaguid');
  });

  it('has transports varchar (comma-separated: usb,nfc,ble,internal,hybrid)', () => {
    expect(colNames()).toContain('transports');
  });

  it('has driver_id uuid not null (FK to driver)', () => {
    const c = cfg.columns.find((x) => x.name === 'driver_id');
    expect(c?.notNull).toBe(true);
  });

  it('has device_id uuid (FK to device_registry, nullable — passkey may outlive a device row)', () => {
    expect(colNames()).toContain('device_id');
  });

  it('has tenancy columns (company_id, business_unit_id, depot_id, legal_entity_id)', () => {
    const names = colNames();
    expect(names).toContain('company_id');
    expect(names).toContain('business_unit_id');
    expect(names).toContain('depot_id');
    expect(names).toContain('legal_entity_id');
  });

  it('has created_at timestamp not null', () => {
    const c = cfg.columns.find((x) => x.name === 'created_at');
    expect(c?.notNull).toBe(true);
  });

  it('has last_used_at timestamp nullable', () => {
    expect(colNames()).toContain('last_used_at');
  });

  it('has unique index on credential_id (global WebAuthn uniqueness)', () => {
    const hasUniqueOnCredentialId = cfg.indexes.some(
      (idx) => idx.config.unique === true && idx.config.columns.some((col) => 'name' in col && col.name === 'credential_id'),
    );
    expect(hasUniqueOnCredentialId).toBe(true);
  });

  it('has index on driver_id for per-driver passkey listing', () => {
    const hasDriverIdx = cfg.indexes.some((idx) =>
      idx.config.columns.some((col) => 'name' in col && col.name === 'driver_id'),
    );
    expect(hasDriverIdx).toBe(true);
  });
});
