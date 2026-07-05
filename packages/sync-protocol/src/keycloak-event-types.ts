// packages/sync-protocol/src/keycloak-event-types.ts
// Wire schema for a Keycloak master-realm user login event, as returned by the
// admin events API (GET /admin/realms/master/events?type=LOGIN). Consumed by the
// API-side break-glass login monitor, which pages via Sentry on any
// fleet-breakglass-* sign-in (see context/keycloak-break-glass-runbook.md).
//
// DELIBERATELY z.looseObject (NOT .strict/strictObject like our OWN payloads in
// extraction-types.ts). This event is emitted by an EXTERNAL, versioned system:
//   - A strict schema would THROW when a future Keycloak version adds a field,
//     silently killing the monitor — a fail-OPEN security hole. Forbidden here.
//   - loose is also forensically correct: unknown fields (IP geo, auth_method,
//     etc.) ride through into the Sentry alert payload for incident context.
// We strictly validate ONLY the fields the classifier + cursor depend on; every
// other key Keycloak sends is preserved untouched. Do not "tighten" this to
// strict — that reintroduces the fail-open.
import { z } from 'zod';

/** Nested details map. Keycloak puts the (attempted) username here on LOGIN and
 *  LOGIN_ERROR. Loose so other detail keys survive; optional so event types that
 *  omit details still parse. */
export const KeycloakEventDetailsSchema = z.looseObject({
  username: z.string().optional(),
});
export type KeycloakEventDetails = z.infer<typeof KeycloakEventDetailsSchema>;

/** A single user event from the Keycloak admin events API. Required fields are
 *  those the monitor keys on; `time` (epoch ms) drives cursor + dedup. */
export const KeycloakLoginEventSchema = z.looseObject({
  time: z.number().int().nonnegative(),
  type: z.string().min(1),
  realmId: z.string().min(1),
  userId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  ipAddress: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  details: KeycloakEventDetailsSchema.optional(),
});
export type KeycloakLoginEvent = z.infer<typeof KeycloakLoginEventSchema>;
