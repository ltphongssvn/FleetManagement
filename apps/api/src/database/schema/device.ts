// apps/api/src/database/schema/device.ts
// Device registry + session tables per Frozen Stack PDF "Session/revocation".
// device_session.revoked_at is authoritative for session lifecycle.
// Attestation columns: per-device record of last accepted hardware attestation
// (Android Key Attestation / iOS App Attest). Nullable until first attest.
// AttestationService verifies the proof and persists the attested key material
// + flips binding_status to pending for admin activation.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, index, uniqueIndex, text, integer } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';
export const deviceRegistry = pgTable(
  'device_registry',
  {
    deviceId: uuid('device_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    operatorId: uuid('operator_id').notNull(),
    platform: varchar('platform', { length: 32 }).notNull(),
    appVersion: varchar('app_version', { length: 32 }).notNull(),
    expoPushToken: varchar('expo_push_token', { length: 256 }),
    udid: varchar('udid', { length: 128 }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    attestationPlatform: varchar('attestation_platform', { length: 16 }),
    attestationVerifiedAt: timestamp('attestation_verified_at', { withTimezone: true, mode: 'date' }),
    attestationTokenHash: varchar('attestation_token_hash', { length: 64 }),
    // Hardware device binding (device-binding arc, Phase 3). installation_id is
    // the per-platform stable installation identity (Android SSAID / iOS IDFV);
    // a CORRELATION key only, never proof. Trust comes from the attested
    // hardware key below. binding_status is the TOFU lifecycle:
    // pending -> active (ops-web admin) -> revoked (recorded, never deleted).
    installationId: varchar('installation_id', { length: 128 }),
    bindingStatus: varchar('binding_status', { length: 16 }).notNull().default('pending'),
    bindingRevokedAt: timestamp('binding_revoked_at', { withTimezone: true, mode: 'date' }),
    bindingRevokedReason: varchar('binding_revoked_reason', { length: 64 }),
    // Attested hardware key material (public only; the private key never
    // leaves the device secure element). counter = iOS App Attest signCount
    // for assertion monotonicity; environment = production vs development
    // (App Attest sandbox aaguid on Ad Hoc builds).
    attestationKeyId: varchar('attestation_key_id', { length: 128 }),
    attestationPublicKeySpki: text('attestation_public_key_spki'),
    attestationSecurityLevel: varchar('attestation_security_level', { length: 32 }),
    attestationEnvironment: varchar('attestation_environment', { length: 32 }),
    attestationCounter: integer('attestation_counter'),
  },
  (t) => [
    index('device_registry_operator_idx').on(t.operatorId),
    index('device_registry_company_idx').on(t.companyId),
    uniqueIndex('device_registry_operator_platform_uq').on(t.operatorId, t.platform),
    // One binding per hardware identity per platform per company. Partial-free:
    // Postgres treats NULL installation_id rows as distinct, so legacy rows
    // enrolled before the binding arc coexist until first identity-bearing enroll.
    uniqueIndex('device_registry_company_platform_installation_uq').on(t.companyId, t.platform, t.installationId),
  ],
);
export const deviceSession = pgTable(
  'device_session',
  {
    deviceSessionId: uuid('device_session_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    deviceId: uuid('device_id').notNull().references(() => deviceRegistry.deviceId),
    operatorId: uuid('operator_id').notNull(),
    surface: varchar('surface', { length: 16 }).notNull(),
    sessionMode: varchar('session_mode', { length: 16 }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revocationReason: varchar('revocation_reason', { length: 64 }),
    revocationReasonSchemaVersion: uuid('revocation_reason_schema_version'),
    tokenConsumedAt: timestamp('token_consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('device_session_device_idx').on(t.deviceId),
    index('device_session_operator_surface_idx').on(t.operatorId, t.surface),
    index('device_session_revoked_at_idx').on(t.revokedAt),
    // Defense in depth: enforces "one mutating session per (operator, surface)"
    // at DB level so concurrent issueSession calls cannot both succeed.
    // Partial: only active (non-revoked) mutating sessions are constrained.
    uniqueIndex('device_session_one_mutating_per_operator_surface_uq')
      .on(t.operatorId, t.surface)
      .where(sql`session_mode = 'mutating' AND revoked_at IS NULL`),
  ],
);
export type DeviceRegistry = typeof deviceRegistry.$inferSelect;
export type NewDeviceRegistry = typeof deviceRegistry.$inferInsert;
export type DeviceSession = typeof deviceSession.$inferSelect;
export type NewDeviceSession = typeof deviceSession.$inferInsert;
