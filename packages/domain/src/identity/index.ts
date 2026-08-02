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

export type { OperatorContext } from './operator-context.js';

export {
  normalizeDisplayName,
  personNameMatchKey,
  DriverNameSchema,
  type DriverName,
} from './person-name.js';

export {
  suggestDistinctDriverName,
  DISTINCT_NAME_SUFFIXES,
  type DistinctNameSuffix,
} from './distinct-person-name.js';
