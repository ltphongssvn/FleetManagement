// packages/sync-protocol/test/driver-orders-pagination-contract.test.ts
// Contract tests (RED-first) for the driver-app 'Xem Lệnh Điều Xe' pagination
// feature: the driver completed-trips page query + response envelope SSOT.
//
// Design pinned here:
// - The COMPLETED surface is its own endpoint; the query schema has NO 'group'
//   param (the endpoint IS the finished partition). A stray 'group' key must be
//   rejected via .strict() — that design decision gets its own test below.
// - page/pageSize reuse the board's shared server caps (ROAD_RUN_PAGE_SIZE_MAX /
//   ROAD_RUN_PAGE_SIZE_DEFAULT) so every paginated surface shares ONE cap policy.
// - The envelope is makePaginatedResponseSchema(ListAssignedRowSchema): the SAME
//   canonical driver row GET /transport-orders/assigned already serves, so the
//   assignments screen and the completed screen render one row shape.
// - search is optional free text (order ref / customer name), min length 1.
import { describe, it, expect } from 'vitest';
import {
  DriverCompletedPageQuerySchema,
  DriverCompletedPageResponseSchema,
} from '../src/driver-orders-pagination-contract.js';
import {
  ROAD_RUN_PAGE_SIZE_DEFAULT,
  ROAD_RUN_PAGE_SIZE_MAX,
} from '../src/dispatch-board-pagination-contract.js';
import type { ListAssignedRow } from '../src/list-assigned-contract.js';

// A complete canonical driver row (every ListAssignedRow key, production-shaped).
const row: ListAssignedRow = {
  transportOrderId: 'to-1',
  externalRef: 'XTT.06-008',
  roadRunId: 'rr-1',
  state: 'completed',
  plannedStartAt: '2026-06-12T01:00:00.000Z',
  createdAt: '2026-06-10T01:00:00.000Z',
  startedAt: '2026-06-12T02:00:00.000Z',
  completedAt: '2026-06-12T09:30:00.000Z',
  orderRef: 'XTT.06-008',
  plate: '62H 06209',
  customerName: 'ĐẠI THÀNH',
  cargoName: null,
  driverName: null,
  pickupName: 'Chơn Chính',
  deliveryName: 'HIỀN NGUYỄN',
  canCancel: true,
  cancelBlockedReason: null,
  stops: [
    {
      sequence: 1,
      stopType: 'pickup',
      plannedAt: '2026-06-12T01:30:00.000Z',
      warehouseName: 'Chơn Chính',
      arrivedAt: null,
      departedAt: null,
      // EXPAND-only proof field (2026): the canonical row now carries the same
      // Phieu Can proof the board stop carries. null here = no committed photo
      // on this fixture stop, which is what the parser also defaults to.
      proof: null,
    },
  ],
};

describe('DriverCompletedPageQuerySchema', () => {
  it('defaults page=1 and pageSize to the shared board default on empty input', () => {
    expect(DriverCompletedPageQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: ROAD_RUN_PAGE_SIZE_DEFAULT,
    });
  });
  it('coerces numeric query strings (page/pageSize arrive as strings)', () => {
    expect(DriverCompletedPageQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });
  it('rejects page < 1 (kills positive() removal)', () => {
    expect(DriverCompletedPageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
  it('rejects pageSize over the shared server cap (kills max() removal)', () => {
    expect(
      DriverCompletedPageQuerySchema.safeParse({ pageSize: String(ROAD_RUN_PAGE_SIZE_MAX + 1) }).success,
    ).toBe(false);
  });
  it('accepts an optional search term and preserves it', () => {
    expect(DriverCompletedPageQuerySchema.parse({ search: 'XTT.06' }).search).toBe('XTT.06');
  });
  it('rejects an empty search term (kills min(1) removal)', () => {
    expect(DriverCompletedPageQuerySchema.safeParse({ search: '' }).success).toBe(false);
  });
  it('has NO group param: a stray group key is rejected by .strict() — the endpoint IS the finished partition', () => {
    expect(DriverCompletedPageQuerySchema.safeParse({ group: 'finished' }).success).toBe(false);
  });
  it('rejects other stray keys (.strict())', () => {
    expect(DriverCompletedPageQuerySchema.safeParse({ bogus: 1 }).success).toBe(false);
  });
});

describe('DriverCompletedPageResponseSchema', () => {
  const good = {
    data: [row],
    page: 1,
    pageSize: ROAD_RUN_PAGE_SIZE_DEFAULT,
    total: 1,
    totalPages: 1,
    hasMore: false,
  };
  it('accepts a well-formed page whose rows are canonical ListAssignedRow', () => {
    expect(DriverCompletedPageResponseSchema.parse(good)).toEqual(good);
  });
  it('rejects a row missing a required key (kills row-schema drift)', () => {
    const { roadRunId, ...broken } = row;
    void roadRunId;
    expect(DriverCompletedPageResponseSchema.safeParse({ ...good, data: [broken] }).success).toBe(false);
  });
  it('requires the hasMore flag (kills field removal)', () => {
    const { hasMore, ...withoutFlag } = good;
    void hasMore;
    expect(DriverCompletedPageResponseSchema.safeParse(withoutFlag).success).toBe(false);
  });
  it('rejects a negative total (kills nonnegative() removal)', () => {
    expect(DriverCompletedPageResponseSchema.safeParse({ ...good, total: -1 }).success).toBe(false);
  });
});
