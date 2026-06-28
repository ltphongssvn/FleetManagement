// packages/sync-protocol/test/list-assigned-contract.test.ts
// RED-first (P0-#2, 2026): single-source-of-truth for the assigned-orders /
// review row contract. This shape was hand-written TWICE -- in apps/api
// transport-orders.dto.ts (ListAssignedRow) and again in apps/ops-web
// dispatch/types.ts -- and the ops-web review page CAST the BFF response with
// 'as ListAssignedRow' instead of validating it (a trust-boundary gap). One Zod
// schema here is the source of truth; the API DTO imports + re-exports it, the
// ops-web types re-export the inferred type, and the review page parses at the
// boundary. Mirrors the sibling DispatchBoardRowSchema (tolerant/strip; nullable
// enrichment fields; ISO strings not re-validated as .datetime()).
//
// Written before packages/sync-protocol/src/list-assigned-contract.ts exists, so
// it fails at import resolution until the source + barrel export land.
import { describe, it, expect } from 'vitest';
import {
  ListAssignedRowStopSchema,
  ListAssignedRowSchema,
  ListAssignedResponseSchema,
  type ListAssignedRow,
  type ListAssignedResponse,
} from '../src/list-assigned-contract.js';

// A representative row exactly as the API listAssigned/findById produces it.
const stop = {
  sequence: 1,
  stopType: 'pickup',
  plannedAt: '2026-06-12T03:04:05.000Z',
  warehouseName: 'Kho Cat Lai',
  arrivedAt: null,
  departedAt: null,
};
const row = {
  transportOrderId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  externalRef: 'XT6.06-001',
  roadRunId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
  state: 'assigned',
  plannedStartAt: '2026-06-12T03:00:00.000Z',
  createdAt: '2026-06-11T09:00:00.000Z',
  startedAt: null,
  completedAt: null,
  orderRef: 'XT6.06-001',
  plate: '51C-123.45',
  customerName: 'Cong ty TNHH ABC',
  cargoName: 'Thep cuon',
  driverName: 'Nguyen Van A',
  pickupName: 'Kho Cat Lai',
  deliveryName: 'Kho Song Than',
  stops: [stop],
};

describe('@fleet/sync-protocol - ListAssignedRowStopSchema', () => {
  it('parses a representative stop', () => {
    const r = ListAssignedRowStopSchema.safeParse(stop);
    expect(r.success).toBe(true);
  });
  it('accepts null timestamps (not-yet-arrived stop)', () => {
    const r = ListAssignedRowStopSchema.safeParse({ ...stop, plannedAt: null, warehouseName: null });
    expect(r.success).toBe(true);
  });
});

describe('@fleet/sync-protocol - ListAssignedRowSchema', () => {
  it('parses a full representative row', () => {
    const r = ListAssignedRowSchema.safeParse(row);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.transportOrderId).toBe(row.transportOrderId);
      expect(r.data.stops).toHaveLength(1);
    }
  });
  it('accepts null enrichment fields (pre-projection / missing joins)', () => {
    const sparse = {
      ...row,
      externalRef: null, plannedStartAt: null, createdAt: null, startedAt: null,
      completedAt: null, orderRef: null, plate: null, customerName: null,
      cargoName: null, driverName: null, pickupName: null, deliveryName: null,
      stops: [],
    };
    expect(ListAssignedRowSchema.safeParse(sparse).success).toBe(true);
  });
  it('rejects a row missing the required transportOrderId', () => {
    const { transportOrderId: _omit, ...bad } = row;
    expect(ListAssignedRowSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects a non-string state', () => {
    expect(ListAssignedRowSchema.safeParse({ ...row, state: 123 }).success).toBe(false);
  });
  it('infers a type assignable from the parsed data', () => {
    const parsed: ListAssignedRow = ListAssignedRowSchema.parse(row);
    expect(parsed.roadRunId).toBe(row.roadRunId);
  });
});

describe('@fleet/sync-protocol - ListAssignedResponseSchema', () => {
  it('parses the rows envelope', () => {
    const r = ListAssignedResponseSchema.safeParse({ rows: [row] });
    expect(r.success).toBe(true);
    if (r.success) {
      const resp: ListAssignedResponse = r.data;
      expect(resp.rows).toHaveLength(1);
    }
  });
});
