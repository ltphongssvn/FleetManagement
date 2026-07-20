// apps/api/src/database/schema/device-binding.ts
// Append-only audit trail of device attestation verification outcomes
// (device-binding arc, Phase 3). Every nonce-verify attempt -- accepted or
// rejected -- lands here with the outcome and (when available) the hardware
// security level. Rows are never updated or deleted: the table IS the audit
// trail, matching the driver_refresh_token append-only pattern. Only a
// sha-256 hex hash of the platform token is stored, never the raw token.
import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';
import { deviceRegistry } from './device.js';

export const deviceAttestationEvent = pgTable(
  'device_attestation_event',
  {
    attestationEventId: uuid('attestation_event_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    deviceId: uuid('device_id').notNull().references(() => deviceRegistry.deviceId),
    operatorId: uuid('operator_id').notNull(),
    platform: varchar('platform', { length: 16 }).notNull(),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    securityLevel: varchar('security_level', { length: 32 }),
    tokenHash: varchar('token_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('device_attestation_event_device_idx').on(t.deviceId),
    index('device_attestation_event_operator_idx').on(t.operatorId),
    index('device_attestation_event_created_idx').on(t.createdAt),
  ],
);

export type DeviceAttestationEvent = typeof deviceAttestationEvent.$inferSelect;
export type NewDeviceAttestationEvent = typeof deviceAttestationEvent.$inferInsert;
