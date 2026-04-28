// apps/api/src/database/schema/device.ts
// Device registry + session tables per Frozen Stack PDF "Session/revocation".
// device_session.revoked_at is authoritative for session lifecycle.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
    enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('device_registry_operator_idx').on(t.operatorId),
    index('device_registry_company_idx').on(t.companyId),
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
