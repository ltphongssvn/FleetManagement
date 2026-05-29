// packages/domain/src/identity/surface.ts
import { z } from 'zod';

/**
 * Session surface — the operational context attached at session issue.
 * Resolved from device_session in HTTP and WebSocket guards;
 * the /config/client OpenAPI guard rejects client-supplied surface values.
 *
 * @see Frozen Stack PDF section "Session/revocation"
 */
export const SessionSurfaceSchema = z.enum(['road', 'yard', 'depot', 'dispatch']);
export type SessionSurface = z.infer<typeof SessionSurfaceSchema>;

/** Frozen runtime list of session surfaces (immutable for defense in depth). */
export const SESSION_SURFACES: readonly SessionSurface[] = Object.freeze(SessionSurfaceSchema.options);

/**
 * Session mode — only one mutating session per (operator_id, surface);
 * shadow sessions are read-only observers capped by config.
 *
 * @see Frozen Stack PDF section "Session/revocation"
 */
export const SessionModeSchema = z.enum(['mutating', 'shadow']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** Frozen runtime list of session modes. */
export const SESSION_MODES: readonly SessionMode[] = Object.freeze(SessionModeSchema.options);
