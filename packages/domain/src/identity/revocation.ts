// packages/domain/src/identity/revocation.ts
import { z } from 'zod';

/**
 * Revocation reason codes carried in lockTransition events.
 * Schema-first SSOT enables tolerant-reader pattern: older clients gracefully
 * skip reasons they do not recognise via safeParse + version negotiation.
 *
 * @see Frozen Stack PDF section "Session/revocation" — versioned reason codes
 */
export const RevocationReasonSchema = z.enum([
  'operator_logout',
  'admin_revoke',
  'device_lost',
  'session_superseded',
  'shift_end',
  'security_incident',
  'config_breaking_change',
]);
export type RevocationReason = z.infer<typeof RevocationReasonSchema>;

/** Frozen runtime list of revocation reasons. */
export const REVOCATION_REASONS: readonly RevocationReason[] = Object.freeze(RevocationReasonSchema.options);

/**
 * Schema version bumped when reason-code SEMANTICS change (rename/redefine).
 * Adding a new reason does NOT bump the version — additive evolution is
 * backward-compatible by design.
 *
 * @see Frozen Stack PDF — revocation_reason_schema_version
 */
export const REVOCATION_REASON_SCHEMA_VERSION = 1 as const;

/**
 * Revocation event envelope carried in lockTransition Socket.IO events.
 * Includes schemaVersion so consumers can apply tolerant-reader logic
 * across forward/backward compatible deployments.
 *
 * @see Frozen Stack PDF section "Realtime" - lockTransition events
 */
export interface RevocationEvent {
  readonly reasonSchemaVersion: typeof REVOCATION_REASON_SCHEMA_VERSION;
  readonly reason: RevocationReason;
  readonly revokedAt: string;
}

/** Zod schema for RevocationEvent — validates network payloads at API/WS boundaries. */
export const RevocationEventSchema = z.object({
  reasonSchemaVersion: z.literal(REVOCATION_REASON_SCHEMA_VERSION),
  reason: RevocationReasonSchema,
  revokedAt: z.string().datetime(),
});
