// apps/api/src/database/schema/keycloak-event-poll-cursor.ts
//
// Single-row high-water-mark for the break-glass login monitor's poll of the
// Keycloak master-realm login-events API (see context/keycloak-break-glass-runbook.md).
//
// NOT multi-tenant (no ...tenancyColumns): this cursor tracks the monitor's
// position against the MASTER realm — an infrastructure concern with no company
// tenancy. Deliberately global.
//
// Invariant enforced at DB level (last line of defense behind the repository):
//   - exactly ONE row ever exists: primary key is a fixed sentinel 'global',
//     and a CHECK pins id to that literal, so no second cursor can be inserted.
//
// Cursor semantics: the poll queries events with time >= last_event_time_ms and
// de-dupes anything already seen; last_event_id breaks ties for multiple events
// sharing the same epoch millisecond so none is double-alerted or skipped across
// API restarts. last_event_time_ms is epoch milliseconds (Keycloak's event.time),
// stored as bigint to survive year-2038.
import { pgTable, varchar, bigint, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const keycloakEventPollCursor = pgTable(
  'keycloak_event_poll_cursor',
  {
    id: varchar('id', { length: 16 }).primaryKey().default('global'),
    lastEventTimeMs: bigint('last_event_time_ms', { mode: 'number' }).notNull().default(0),
    lastEventId: varchar('last_event_id', { length: 128 }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  () => [
    check('kepc_singleton', sql.raw("id = 'global'")),
    check('kepc_last_event_time_nonneg', sql.raw('last_event_time_ms >= 0')),
  ],
);
export type KeycloakEventPollCursor = typeof keycloakEventPollCursor.$inferSelect;
export type NewKeycloakEventPollCursor = typeof keycloakEventPollCursor.$inferInsert;
