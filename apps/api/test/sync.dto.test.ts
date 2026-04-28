// apps/api/test/sync.dto.test.ts
import { describe, it, expect } from 'vitest';
import { SyncRequestDto, SyncActionDto } from '../src/sync/sync.dto.js';

const validAction = {
  actionId: '00000000-0000-0000-0000-000000000001',
  aggregateType: 'transport_order',
  aggregateId: '00000000-0000-0000-0000-000000000002',
  payload: { state: 'assigned' },
  timestamp: '2026-04-27T18:00:00.000Z',
};

describe('@fleet/api - SyncActionDto', () => {
  it('accepts valid action', () => {
    expect(SyncActionDto.parse(validAction)).toEqual(validAction);
  });

  it('rejects non-uuid actionId', () => {
    expect(SyncActionDto.safeParse({ ...validAction, actionId: 'not-uuid' }).success).toBe(false);
  });

  it('rejects empty aggregateType', () => {
    expect(SyncActionDto.safeParse({ ...validAction, aggregateType: '' }).success).toBe(false);
  });

  it('rejects non-ISO timestamp', () => {
    expect(SyncActionDto.safeParse({ ...validAction, timestamp: 'yesterday' }).success).toBe(false);
  });
});

describe('@fleet/api - SyncRequestDto', () => {
  it('accepts request with no actions', () => {
    expect(SyncRequestDto.parse({ cursor: '0', actions: [] }).cursor).toBe('0');
  });

  it('accepts request with valid actions', () => {
    const req = SyncRequestDto.parse({ cursor: '0', actions: [validAction] });
    expect(req.actions).toHaveLength(1);
  });

  it('rejects request with > 500 actions', () => {
    const actions = Array.from({ length: 501 }, (_, i) => ({
      ...validAction,
      actionId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    }));
    expect(SyncRequestDto.safeParse({ cursor: '0', actions }).success).toBe(false);
  });
});
