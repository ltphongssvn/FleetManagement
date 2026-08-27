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

// The factories VALIDATE now. They used to be `return raw as ActionId` -- a
// cast with a friendly name that accepted any string, so these tests asserted
// createActionId('abc-123') === 'abc-123' and pinned exactly the hole they
// should have caught. The PDF specifies UUIDv7 for action and aggregate ids;
// blessing raw data into a branded type is what parsing is for, so a malformed
// id now fails where it is created rather than deep inside a query.
describe('@fleet/sync-protocol — branded ID factories validate', () => {
  const UUID_A = '018f4d3c-1a2b-7c3d-8e4f-5a6b7c8d9e0f';
  const UUID_B = '018f4d3c-1a2b-7c3d-8e4f-5a6b7c8d9e10';

  it('creates an ActionId from a valid UUID', () => {
    expect(createActionId(UUID_A)).toBe(UUID_A);
  });

  it('creates an AggregateId from a valid UUID', () => {
    expect(createAggregateId(UUID_B)).toBe(UUID_B);
  });

  // The cursor is an opaque server-issued token, so its format is the server's
  // business: the schema constrains only that it is a string.
  it('creates a SyncCursor from any string, since the token is opaque', () => {
    expect(createSyncCursor('cursor-456')).toBe('cursor-456');
    expect(createSyncCursor('0')).toBe('0');
  });

  it('REJECTS a non-UUID action id rather than blessing it', () => {
    expect(() => createActionId('abc-123')).toThrow();
    expect(() => createActionId('')).toThrow();
  });

  it('REJECTS a non-UUID aggregate id', () => {
    expect(() => createAggregateId('agg-789')).toThrow();
  });

  // Branding is a compile-time construct: the runtime value is unchanged, so a
  // branded id still serialises and compares as the plain string it is.
  it('does not alter the runtime value', () => {
    expect(JSON.stringify({ id: createActionId(UUID_A) })).toBe(`{"id":"${UUID_A}"}`);
  });
});
