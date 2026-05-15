// apps/api/test/passkey-credential.repository.test.ts
// RED: repository encapsulates all passkey_credential DB access.
// Integration test using pglite. PGlite only accepts one statement per execute().
import { describe, it, expect, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { PasskeyCredentialRepository } from '../src/auth/passkey-credential.repository.js';

const TENANCY = {
  companyId: '11111111-1111-1111-1111-111111111111',
  businessUnitId: '22222222-2222-2222-2222-222222222222',
  depotId: '33333333-3333-3333-3333-333333333333',
  legalEntityId: '44444444-4444-4444-4444-444444444444',
};
const DRIVER_ID = '55555555-5555-5555-5555-555555555555';
const OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

const DDL_STATEMENTS: string[] = [
  `CREATE TABLE driver (
      driver_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL,
      business_unit_id uuid NOT NULL,
      depot_id uuid NOT NULL,
      legal_entity_id uuid NOT NULL,
      full_name varchar(200) NOT NULL,
      phone varchar(32),
      password_hash varchar(128),
      operator_id uuid,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  `CREATE TABLE device_registry (
      device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL, business_unit_id uuid NOT NULL,
      depot_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
      operator_id uuid NOT NULL, platform varchar(32) NOT NULL,
      app_version varchar(32) NOT NULL, expo_push_token varchar(256),
      udid varchar(128),
      enrolled_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz
    )`,
  `CREATE TABLE passkey_credential (
      passkey_credential_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL, business_unit_id uuid NOT NULL,
      depot_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
      driver_id uuid NOT NULL REFERENCES driver(driver_id),
      device_id uuid REFERENCES device_registry(device_id),
      credential_id bytea NOT NULL,
      public_key bytea NOT NULL,
      sign_count bigint NOT NULL DEFAULT 0,
      aaguid uuid,
      transports varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz
    )`,
  `CREATE UNIQUE INDEX passkey_credential_credential_id_uq ON passkey_credential(credential_id)`,
];

async function setupDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema, casing: 'snake_case' });
  for (const stmt of DDL_STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
  await db.insert(schema.driver).values({
    driverId: DRIVER_ID, ...TENANCY, fullName: 'Test', operatorId: OPERATOR_ID, active: true,
  });
  return db;
}

describe('PasskeyCredentialRepository', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;
  let repo: PasskeyCredentialRepository;
  beforeEach(async () => {
    db = await setupDb();
    repo = new PasskeyCredentialRepository(db);
  });

  it('insert + findByCredentialId round-trip', async () => {
    const credId = Buffer.from('cred-id-1');
    const pubKey = Buffer.from('cose-public-key');
    await repo.insert({
      ...TENANCY,
      driverId: DRIVER_ID,
      deviceId: null,
      credentialId: credId,
      publicKey: pubKey,
      signCount: 0,
      aaguid: null,
      transports: 'internal,hybrid',
    });
    const found = await repo.findByCredentialId(credId);
    expect(found).not.toBeNull();
    expect(found?.driverId).toBe(DRIVER_ID);
    expect(found?.signCount).toBe(0);
    expect(found?.publicKey.equals(pubKey)).toBe(true);
  });

  it('findByCredentialId returns null when not found', async () => {
    const found = await repo.findByCredentialId(Buffer.from('nope'));
    expect(found).toBeNull();
  });

  it('credentialIdExists returns true after insert', async () => {
    const credId = Buffer.from('cred-id-2');
    expect(await repo.credentialIdExists(credId)).toBe(false);
    await repo.insert({
      ...TENANCY, driverId: DRIVER_ID, deviceId: null,
      credentialId: credId, publicKey: Buffer.from('pk'), signCount: 0,
      aaguid: null, transports: null,
    });
    expect(await repo.credentialIdExists(credId)).toBe(true);
  });

  it('countByDriverId reflects rows for that driver only', async () => {
    expect(await repo.countByDriverId(DRIVER_ID)).toBe(0);
    await repo.insert({
      ...TENANCY, driverId: DRIVER_ID, deviceId: null,
      credentialId: Buffer.from('a'), publicKey: Buffer.from('pk'), signCount: 0,
      aaguid: null, transports: null,
    });
    await repo.insert({
      ...TENANCY, driverId: DRIVER_ID, deviceId: null,
      credentialId: Buffer.from('b'), publicKey: Buffer.from('pk'), signCount: 0,
      aaguid: null, transports: null,
    });
    expect(await repo.countByDriverId(DRIVER_ID)).toBe(2);
  });

  it('updateSignCountAndLastUsed bumps sign_count and stamps last_used_at', async () => {
    const credId = Buffer.from('cred-id-3');
    await repo.insert({
      ...TENANCY, driverId: DRIVER_ID, deviceId: null,
      credentialId: credId, publicKey: Buffer.from('pk'), signCount: 5,
      aaguid: null, transports: null,
    });
    await repo.updateSignCountAndLastUsed(credId, 6);
    const after = await repo.findByCredentialId(credId);
    expect(after?.signCount).toBe(6);
    expect(after?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('global unique on credential_id is enforced (insert duplicate rejected)', async () => {
    const credId = Buffer.from('dup');
    await repo.insert({
      ...TENANCY, driverId: DRIVER_ID, deviceId: null,
      credentialId: credId, publicKey: Buffer.from('pk'), signCount: 0,
      aaguid: null, transports: null,
    });
    await expect(
      repo.insert({
        ...TENANCY, driverId: DRIVER_ID, deviceId: null,
        credentialId: credId, publicKey: Buffer.from('pk2'), signCount: 0,
        aaguid: null, transports: null,
      }),
    ).rejects.toThrow();
  });
});
