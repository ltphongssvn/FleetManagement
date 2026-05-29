// packages/sync-protocol/test/sync-types.test.ts
// TDD: verify sync protocol wire types match PDF specification.
// Imports from package barrel (not src/) to validate export surface.

import { describe, it, expect } from 'vitest';
import {
  SYNC_STATUSES,
  SYNC_ACTION_RESULTS,
  createActionId,
  createSyncCursor,
  createAggregateId,
} from '../src/index.js';

describe('@fleet/sync-protocol — sync statuses', () => {
  it('should define exactly 8 sync statuses per PDF spec', () => {
    expect(SYNC_STATUSES).toHaveLength(8);
  });

  it('should include all PDF-mandated statuses', () => {
    const expected = [
      'ok',
      'cursor_expired',
      'config_refresh_required',
      'artifact_generation_in_progress',
      'artifact_unavailable',
      'lock_contended',
      'bootstrap_config_stale',
      'bootstrap_format_deprecated',
    ];
    for (const status of expected) {
      expect(SYNC_STATUSES).toContain(status);
    }
  });
});

describe('@fleet/sync-protocol — action results', () => {
  it('should define exactly 7 action result states per PDF spec', () => {
    expect(SYNC_ACTION_RESULTS).toHaveLength(7);
  });

  it('should include all PDF-mandated results', () => {
    const expected = [
      'applied',
      'duplicate',
      'rejected',
      'superseded',
      'awaiting_handoff',
      'awaiting_proof',
      'hint_conflict',
    ];
    for (const result of expected) {
      expect(SYNC_ACTION_RESULTS).toContain(result);
    }
  });
});

describe('@fleet/sync-protocol — branded ID factories', () => {
  it('should create ActionId from raw string', () => {
    const id = createActionId('abc-123');
    expect(id).toBe('abc-123');
  });

  it('should create SyncCursor from raw string', () => {
    const cursor = createSyncCursor('cursor-456');
    expect(cursor).toBe('cursor-456');
  });

  it('should create AggregateId from raw string', () => {
    const aggId = createAggregateId('agg-789');
    expect(aggId).toBe('agg-789');
  });
});
