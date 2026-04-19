// packages/sync-protocol/test/sync-types.test.ts
// TDD: verify sync protocol wire types match PDF specification.

import { describe, it, expect } from 'vitest';
import { SYNC_STATUSES } from '../src/sync-types.js';

describe('@fleet/sync-protocol — sync status types', () => {
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

  it('should NOT include any unexpected statuses', () => {
    const expected = new Set([
      'ok',
      'cursor_expired',
      'config_refresh_required',
      'artifact_generation_in_progress',
      'artifact_unavailable',
      'lock_contended',
      'bootstrap_config_stale',
      'bootstrap_format_deprecated',
    ]);
    for (const status of SYNC_STATUSES) {
      expect(expected.has(status)).toBe(true);
    }
  });
});
