// packages/domain/test/dispatch-board-projection.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyDispatchBoardEvent,
  PROJECTION_POLICY_VERSION,
  DISPATCH_BOARD_PROJECTION_NAME,
  type RoadRunProjectionRow,
  type SyncFeedEvent,
} from '../src/projections/dispatch-board-projection.js';
const ROAD_RUN_ID = '11111111-1111-4111-8111-111111111111';
const baseCurrent: RoadRunProjectionRow = {
  roadRunId: ROAD_RUN_ID,
  state: 'planned',
  assignedOperatorId: null,
  assignedAssetId: null,
  plannedStartAt: '2026-04-28T08:00:00.000Z',
  stopCount: 3,
  transportOrderRefs: ['TO-1001', 'TO-1002'],
  serverSeq: 100n,
};
function event(overrides: Partial<SyncFeedEvent> & { delta: unknown }): SyncFeedEvent {
  return {
    serverSeq: 200n,
    aggregateType: 'road_run',
    aggregateId: ROAD_RUN_ID,
    ...overrides,
  };
}
const fullDelta = {
  state: 'planned',
  assignedOperatorId: null,
  assignedAssetId: null,
  plannedStartAt: '2026-04-28T08:00:00.000Z',
  stopCount: 3,
  transportOrderRefs: ['TO-1001'],
};
describe('@fleet/main-worker - applyDispatchBoardEvent', () => {
  it('exports stable identifiers', () => {
    expect(PROJECTION_POLICY_VERSION).toBe('projection-dispatch-board-v1');
    expect(DISPATCH_BOARD_PROJECTION_NAME).toBe('dispatch_board');
  });
  it('returns noop for unobserved aggregate type', () => {
    const result = applyDispatchBoardEvent(
      event({ aggregateType: 'manifest', delta: { state: 'planned' } }),
      null,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('unobserved_aggregate');
  });
  it('returns noop when event serverSeq <= current.serverSeq (stale)', () => {
    const result = applyDispatchBoardEvent(
      event({ serverSeq: 100n, delta: { state: 'dispatched' } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('stale_event');
  });
  it('returns noop when delta is not an object', () => {
    const result = applyDispatchBoardEvent(event({ delta: 'oops' }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('returns noop when delta is a number primitive (isObject typeof guard)', () => {
    const result = applyDispatchBoardEvent(event({ delta: 42 }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('returns noop when delta is a boolean primitive (isObject typeof guard)', () => {
    const result = applyDispatchBoardEvent(event({ delta: true }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('returns noop when delta is an array (isObject Array guard)', () => {
    const result = applyDispatchBoardEvent(event({ delta: ['state', 'planned'] }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('returns soft_delete for tombstone delta with serverSeq propagated for watermarking', () => {
    const result = applyDispatchBoardEvent(
      event({ serverSeq: 250n, delta: { tombstone: true } }),
      baseCurrent,
    );
    expect(result.kind).toBe('soft_delete');
    if (result.kind === 'soft_delete') {
      expect(result.roadRunId).toBe(ROAD_RUN_ID);
      expect(result.serverSeq).toBe(250n);
    }
  });
  it('creates initial row when current is null and all required fields present', () => {
    const result = applyDispatchBoardEvent(
      event({
        delta: {
          state: 'planned',
          assignedOperatorId: null,
          assignedAssetId: null,
          plannedStartAt: '2026-04-28T08:00:00.000Z',
          stopCount: 3,
          transportOrderRefs: ['TO-1001'],
        },
      }),
      null,
    );
    expect(result.kind).toBe('upsert');
    if (result.kind === 'upsert') {
      expect(result.row.state).toBe('planned');
      expect(result.row.serverSeq).toBe(200n);
      expect(result.row.transportOrderRefs).toEqual(['TO-1001']);
    }
  });
  it('rejects initial row creation with missing required fields', () => {
    const result = applyDispatchBoardEvent(event({ delta: { state: 'planned' } }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects initial row creation when only assignedOperatorId is absent', () => {
    const { assignedOperatorId: _omit, ...rest } = fullDelta;
    const result = applyDispatchBoardEvent(event({ delta: rest }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects initial row creation when only assignedAssetId is absent', () => {
    const { assignedAssetId: _omit, ...rest } = fullDelta;
    const result = applyDispatchBoardEvent(event({ delta: rest }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects initial row creation when only plannedStartAt is absent', () => {
    const { plannedStartAt: _omit, ...rest } = fullDelta;
    const result = applyDispatchBoardEvent(event({ delta: rest }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects initial row creation when only stopCount is absent', () => {
    const { stopCount: _omit, ...rest } = fullDelta;
    const result = applyDispatchBoardEvent(event({ delta: rest }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects initial row creation when only transportOrderRefs is absent', () => {
    const { transportOrderRefs: _omit, ...rest } = fullDelta;
    const result = applyDispatchBoardEvent(event({ delta: rest }), null);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('creates initial row when every required field is present (all five gates pass)', () => {
    const result = applyDispatchBoardEvent(event({ delta: fullDelta }), null);
    expect(result.kind).toBe('upsert');
    if (result.kind === 'upsert') {
      expect(result.row.assignedOperatorId).toBeNull();
      expect(result.row.assignedAssetId).toBeNull();
      expect(result.row.plannedStartAt).toBe('2026-04-28T08:00:00.000Z');
      expect(result.row.stopCount).toBe(3);
      expect(result.row.transportOrderRefs).toEqual(['TO-1001']);
    }
  });
  it('rejects invalid state value', () => {
    const result = applyDispatchBoardEvent(event({ delta: { state: 'flying' } }), baseCurrent);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects non-string state value (asState typeof guard)', () => {
    const result = applyDispatchBoardEvent(event({ delta: { state: 42 } }), baseCurrent);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('applies partial update to existing row, preserving unspecified fields', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'dispatched', assignedOperatorId: 'op-1' } }),
      baseCurrent,
    );
    expect(result.kind).toBe('upsert');
    if (result.kind === 'upsert') {
      expect(result.row.state).toBe('dispatched');
      expect(result.row.assignedOperatorId).toBe('op-1');
      expect(result.row.stopCount).toBe(3);
      expect(result.row.transportOrderRefs).toEqual(['TO-1001', 'TO-1002']);
      expect(result.row.serverSeq).toBe(200n);
    }
  });
  it('rejects an explicit undefined-valued field (key present with undefined value is present-but-invalid)', () => {
    // { assignedOperatorId: undefined } -> hasOwnProperty is true, so the
    // present-but-invalid guard fires (fail-closed on upstream corruption).
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'dispatched', assignedOperatorId: undefined } }),
      { ...baseCurrent, assignedOperatorId: 'op-existing' },
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });

  it('rejects whole event when transportOrderRefs has non-string element (no silent fallback)', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', transportOrderRefs: ['TO-1', 42] } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects whole event when stopCount is negative (no silent fallback)', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', stopCount: -1 } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects whole event when stopCount is fractional (asNonNegativeInt isInteger guard)', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', stopCount: 2.5 } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects whole event when stopCount is a non-number (asNonNegativeInt typeof guard)', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', stopCount: '3' } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('accepts stopCount of exactly 0 on update (asNonNegativeInt lower bound is inclusive)', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', stopCount: 0 } }),
      baseCurrent,
    );
    expect(result.kind).toBe('upsert');
    if (result.kind === 'upsert') expect(result.row.stopCount).toBe(0);
  });
  it('rejects whole event when assignedOperatorId is non-string non-null', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', assignedOperatorId: 42 } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('is deterministic (same inputs -> same output)', () => {
    const e = event({ delta: { state: 'started' } });
    const a = applyDispatchBoardEvent(e, baseCurrent);
    const b = applyDispatchBoardEvent(e, baseCurrent);
    expect(a).toEqual(b);
  });
  it('rejects whole event when assignedAssetId is present but non-string non-null (no silent fallback)', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', assignedAssetId: 42 } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('rejects whole event when plannedStartAt is present but non-string non-null (no silent fallback)', () => {
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'planned', plannedStartAt: 42 } }),
      baseCurrent,
    );
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
});
import fc from 'fast-check';
import { SyncFeedEventSchema } from '../src/projections/dispatch-board-projection.js';
describe('@fleet/main-worker - SyncFeedEventSchema (boundary)', () => {
  it('parses bigint serverSeq', () => {
    const r = SyncFeedEventSchema.parse({
      serverSeq: 42n,
      aggregateType: 'road_run',
      aggregateId: ROAD_RUN_ID,
      delta: { state: 'planned' },
    });
    expect(r.serverSeq).toBe(42n);
  });
  it('coerces number serverSeq to bigint', () => {
    const r = SyncFeedEventSchema.parse({
      serverSeq: 100,
      aggregateType: 'road_run',
      aggregateId: ROAD_RUN_ID,
      delta: {},
    });
    expect(r.serverSeq).toBe(100n);
  });
  it('coerces numeric string serverSeq to bigint', () => {
    const r = SyncFeedEventSchema.parse({
      serverSeq: '12345',
      aggregateType: 'road_run',
      aggregateId: ROAD_RUN_ID,
      delta: {},
    });
    expect(r.serverSeq).toBe(12345n);
  });
  it('accepts numeric serverSeq of exactly 0 (lower bound is inclusive)', () => {
    const r = SyncFeedEventSchema.parse({
      serverSeq: 0,
      aggregateType: 'road_run',
      aggregateId: ROAD_RUN_ID,
      delta: {},
    });
    expect(r.serverSeq).toBe(0n);
  });
  it('rejects negative number serverSeq with the documented error message', () => {
    expect(() =>
      SyncFeedEventSchema.parse({
        serverSeq: -1,
        aggregateType: 'road_run',
        aggregateId: ROAD_RUN_ID,
        delta: {},
      }),
    ).toThrow(/serverSeq must be non-negative integer/);
  });
  it('rejects fractional number serverSeq with the documented error message', () => {
    expect(() =>
      SyncFeedEventSchema.parse({
        serverSeq: 1.5,
        aggregateType: 'road_run',
        aggregateId: ROAD_RUN_ID,
        delta: {},
      }),
    ).toThrow(/serverSeq must be non-negative integer/);
  });
  it('rejects non-UUID aggregateId', () => {
    expect(() =>
      SyncFeedEventSchema.parse({
        serverSeq: 1n,
        aggregateType: 'road_run',
        aggregateId: 'nope',
        delta: {},
      }),
    ).toThrow();
  });
  it('rejects extra top-level fields (.strict)', () => {
    expect(() =>
      SyncFeedEventSchema.parse({
        serverSeq: 1n,
        aggregateType: 'road_run',
        aggregateId: ROAD_RUN_ID,
        delta: {},
        extra: 'no',
      }),
    ).toThrow();
  });
});
describe('@fleet/main-worker - applyDispatchBoardEvent property invariants', () => {
  it('never throws; always returns a ProjectionDelta', () => {
    fc.assert(
      fc.property(
        fc.record({
          serverSeq: fc.bigInt({ min: 0n, max: 1_000_000n }),
          aggregateType: fc.constantFrom('road_run', 'manifest', 'transport_order'),
          aggregateId: fc.constant(ROAD_RUN_ID),
          delta: fc.oneof(
            fc.constant(null),
            fc.constant('not-an-object'),
            fc.record({
              state: fc.oneof(
                fc.constantFrom(
                  'planned',
                  'dispatched',
                  'started',
                  'completed',
                  'cancelled',
                  'invalid',
                ),
                fc.integer(),
                fc.constant(null),
              ),
              stopCount: fc.oneof(fc.integer({ min: -10, max: 100 }), fc.constant(null)),
              transportOrderRefs: fc.oneof(
                fc.array(fc.string(), { maxLength: 5 }),
                fc.constant(null),
              ),
              tombstone: fc.oneof(fc.boolean(), fc.constant(undefined)),
            }),
          ),
        }),
        (event) => {
          const r = applyDispatchBoardEvent(event, baseCurrent);
          expect(['noop', 'upsert', 'soft_delete']).toContain(r.kind);
          return true;
        },
      ),
    );
  });
  it('upsert always advances serverSeq strictly past current', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 101n, max: 1_000_000n }), (seq) => {
        const r = applyDispatchBoardEvent(
          {
            serverSeq: seq,
            aggregateType: 'road_run',
            aggregateId: ROAD_RUN_ID,
            delta: { state: 'started' },
          },
          baseCurrent,
        );
        if (r.kind === 'upsert') {
          return r.row.serverSeq === seq && r.row.serverSeq > baseCurrent.serverSeq;
        }
        return true;
      }),
    );
  });
  it('stale events (seq <= current.seq) always noop', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 100n }), (seq) => {
        const r = applyDispatchBoardEvent(
          {
            serverSeq: seq,
            aggregateType: 'road_run',
            aggregateId: ROAD_RUN_ID,
            delta: { state: 'started' },
          },
          baseCurrent,
        );
        return r.kind === 'noop' && r.reason === 'stale_event';
      }),
    );
  });
  it('non-road_run aggregateType always noop with unobserved_aggregate', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s !== 'road_run'),
        (aggregateType) => {
          const r = applyDispatchBoardEvent(
            {
              serverSeq: 999n,
              aggregateType,
              aggregateId: ROAD_RUN_ID,
              delta: { state: 'planned' },
            },
            baseCurrent,
          );
          return r.kind === 'noop' && r.reason === 'unobserved_aggregate';
        },
      ),
    );
  });
});
describe('@fleet/main-worker - applyDispatchBoardEvent additional invariants', () => {
  it('rejects when current.roadRunId does not match event.aggregateId (adapter mismatch guard)', () => {
    const wrongRow: RoadRunProjectionRow = {
      ...baseCurrent,
      roadRunId: '99999999-9999-4999-8999-999999999999',
    };
    const result = applyDispatchBoardEvent(event({ delta: { state: 'dispatched' } }), wrongRow);
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') expect(result.reason).toBe('invalid_delta');
  });
  it('strictly applies when serverSeq = current + 1 (no off-by-one)', () => {
    const result = applyDispatchBoardEvent(
      event({ serverSeq: 101n, delta: { state: 'dispatched' } }),
      baseCurrent,
    );
    expect(result.kind).toBe('upsert');
    if (result.kind === 'upsert') expect(result.row.serverSeq).toBe(101n);
  });
  it('honors explicit null clearing of nullable fields (null is not undefined)', () => {
    const seeded: RoadRunProjectionRow = {
      ...baseCurrent,
      assignedOperatorId: 'op-existing',
    };
    const result = applyDispatchBoardEvent(
      event({ delta: { state: 'dispatched', assignedOperatorId: null } }),
      seeded,
    );
    expect(result.kind).toBe('upsert');
    if (result.kind === 'upsert') expect(result.row.assignedOperatorId).toBeNull();
  });
});
