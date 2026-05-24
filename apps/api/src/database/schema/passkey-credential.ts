// apps/api/src/database/schema/passkey-credential.ts
// WebAuthn/Passkey credential storage. One row per registered credential.
// Per WebAuthn L3 spec: credential_id is globally unique (across all users, all RPs).
// public_key is COSE-encoded (CBOR). sign_count is monotonic; equal-or-lower on
// authentication indicates a cloned authenticator. aaguid identifies the authenticator
// model (e.g. Apple Passkey AAGUID = adce0002-...). transports advertises usable methods.
// device_id is nullable: a passkey may be platform-synced (iCloud/Google Password Manager)
// and outlive any specific device_registry row.
import { pgTable, uuid, varchar, timestamp, bigint, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';
import { deviceRegistry } from './device.js';
import { driver } from './reference.js';
// PGlite returns bytea as Uint8Array; node-postgres returns Buffer. Normalize to Buffer
// on read so callers can rely on Buffer methods (equals, toString, etc.).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
  toDriver(value: Buffer): Buffer { return value; },
  fromDriver(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    throw new Error('bytea fromDriver: expected Buffer or Uint8Array, got ' + typeof value);
  },
});
export const passkeyCredential = pgTable(
  'passkey_credential',
  {
    passkeyCredentialId: uuid('passkey_credential_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    driverId: uuid('driver_id').notNull().references(() => driver.driverId),
    deviceId: uuid('device_id').references(() => deviceRegistry.deviceId),
    credentialId: bytea('credential_id').notNull(),
    publicKey: bytea('public_key').notNull(),
    signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
    aaguid: uuid('aaguid'),
    transports: varchar('transports', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('passkey_credential_credential_id_uq').on(t.credentialId),
    index('passkey_credential_driver_idx').on(t.driverId),
    index('passkey_credential_company_idx').on(t.companyId),
  ],
);
export type PasskeyCredential = typeof passkeyCredential.$inferSelect;
export type NewPasskeyCredential = typeof passkeyCredential.$inferInsert;
