// packages/test-fixtures/test/sync-fixtures.test.ts
// TDD: verify test fixture factories produce valid protocol objects.

import { describe, it, expect } from 'vitest';
import {
  createMockSyncAction,
  createMockSyncRequest,
  createMockSyncResponse,
} from '../src/index.js';
import { SYNC_STATUSES } from '@fleet/sync-protocol';

describe('@fleet/test-fixtures — sync fixtures', () => {
  describe('createMockSyncAction', () => {
    it('should create a valid action with defaults', () => {
      const action = createMockSyncAction();
      expect(action.actionId).toBe('action-001');
      expect(action.aggregateType).toBe('transport_order');
      expect(action.aggregateId).toBe('agg-001');
      expect(action.timestamp).toBeDefined();
    });

    it('should accept partial overrides', () => {
      const action = createMockSyncAction({ aggregateType: 'road_run' });
      expect(action.aggregateType).toBe('road_run');
      expect(action.actionId).toBe('action-001');
    });
  });

  describe('createMockSyncRequest', () => {
    it('should create a valid request with defaults', () => {
      const req = createMockSyncRequest();
      expect(req.cursor).toBe('cursor-000');
      expect(req.actions).toHaveLength(1);
    });

    it('should accept cursor override', () => {
      const req = createMockSyncRequest({ cursor: 'custom-cursor' });
      expect(req.cursor).toBe('custom-cursor');
    });
  });

  describe('createMockSyncResponse', () => {
    it('should create a valid response with defaults', () => {
      const res = createMockSyncResponse();
      expect(res.status).toBe('ok');
      expect(SYNC_STATUSES).toContain(res.status);
      expect(res.eventSeq).toBe(1);
      expect(res.results).toEqual(['applied']);
      expect(res.retryAfterMs).toBeUndefined();
    });

    it('should include retryAfterMs when provided', () => {
      const res = createMockSyncResponse({ retryAfterMs: 5000 });
      expect(res.retryAfterMs).toBe(5000);
    });

    it('should accept status override', () => {
      const res = createMockSyncResponse({ status: 'cursor_expired' });
      expect(res.status).toBe('cursor_expired');
    });
  });
});
