// packages/domain/src/identity/index.ts
// Identity sub-barrel.
export {
  type SessionSurface,
  SessionSurfaceSchema,
  SESSION_SURFACES,
  type SessionMode,
  SessionModeSchema,
  SESSION_MODES,
} from './surface.js';
export {
  type RevocationReason,
  RevocationReasonSchema,
  REVOCATION_REASONS,
  REVOCATION_REASON_SCHEMA_VERSION,
  type RevocationEvent,
  RevocationEventSchema,
} from './revocation.js';
