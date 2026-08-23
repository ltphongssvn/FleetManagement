// apps/api/src/database/schema/driver-refresh-token.ts
// RFC 9700 rotating refresh tokens for the driver public client.
// Hash-at-rest: token_hash is sha-256 hex of the opaque token; the raw token
// exists only in transit and on the device Keychain/Keystore. family_id groups
// a rotation chain: reuse of an already-rotated token revokes the whole family.
// Append-only lifecycle (event-sourced repair protocol): revocation and
// replacement are recorded state changes (revoked_at / revoked_reason /
// replaced_by_token_hash); rows are never deleted -- the table is the audit
// trail for driver session history.
import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';
import { driver } from './reference.js';
export const driverRefreshToken = pgTable(
  'driver_refresh_token',
  {
    driverRefreshTokenId: uuid('driver_refresh_token_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driver.driverId),
    operatorId: uuid('operator_id').notNull(),
    familyId: uuid('family_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: varchar('revoked_reason', { length: 64 }),
    replacedByTokenHash: varchar('replaced_by_token_hash', { length: 64 }),
  },
  (t) => [
    uniqueIndex('driver_refresh_token_hash_uq').on(t.tokenHash),
    index('driver_refresh_token_family_idx').on(t.familyId),
    index('driver_refresh_token_driver_idx').on(t.driverId),
    index('driver_refresh_token_company_idx').on(t.companyId),
  ],
);
export type DriverRefreshToken = typeof driverRefreshToken.$inferSelect;
export type NewDriverRefreshToken = typeof driverRefreshToken.$inferInsert;
