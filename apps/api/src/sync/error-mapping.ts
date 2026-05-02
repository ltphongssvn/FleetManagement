// apps/api/src/sync/error-mapping.ts
// Pure mapping from DB error to SyncActionResult. Extracted from sync.service.ts
// for testability without DB.
import type { SyncActionResult } from '@fleet/sync-protocol';
import { isPgUniqueViolation } from '../common/pg-errors.js';

export function mapDbErrorToSyncResult(err: unknown): SyncActionResult {
  if (isPgUniqueViolation(err)) return 'duplicate';
  return 'rejected';
}
