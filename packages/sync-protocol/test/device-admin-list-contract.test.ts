// packages/sync-protocol/test/device-admin-list-contract.test.ts
// Contract for the admin devices approval queue (P7 slice-A).
// GET /admin/devices is a filtered, offset-paginated collection: the ops-web
// approval UI needs a status filter (default pending == the review queue) plus
// page-number pagination (single-company admin table; offset matches the board
// precedent, not cursor). Query params are a trust boundary (Axis 1): coerce +
// strict + server-capped page size. The response envelope reuses the shared
// makePaginatedResponseSchema factory over the existing AdminDeviceRowSchema
// (Axis 2: one row SSOT, one envelope factory, zero hand-rolled parallel shapes).
import { describe, expect, it } from 'vitest';
import {
  AdminDeviceListQuerySchema,
  AdminDeviceListResponseSchema,
  ADMIN_DEVICE_PAGE_SIZE_MAX,
  ADMIN_DEVICE_PAGE_SIZE_DEFAULT,
} from '../src/device-binding-contract.js';

const GUID = '018f6b2a-1111-7000-8000-000000000001';

describe('AdminDeviceListQuerySchema', () => {
  it('defaults status to pending and page to 1 (the approval queue view)', () => {
    const r = AdminDeviceListQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('pending');
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(ADMIN_DEVICE_PAGE_SIZE_DEFAULT);
    }
  });
  it('coerces string query params (page/pageSize arrive as strings)', () => {
    const r = AdminDeviceListQuerySchema.safeParse({ status: 'active', page: '3', pageSize: '50' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(3);
      expect(r.data.pageSize).toBe(50);
      expect(r.data.status).toBe('active');
    }
  });
  it('accepts each binding status as a filter value', () => {
    for (const s of ['pending', 'active', 'revoked']) {
      expect(AdminDeviceListQuerySchema.safeParse({ status: s }).success).toBe(true);
    }
  });
  it('rejects an unknown status value', () => {
    expect(AdminDeviceListQuerySchema.safeParse({ status: 'approved' }).success).toBe(false);
  });
  it('caps pageSize at the server maximum', () => {
    expect(
      AdminDeviceListQuerySchema.safeParse({ pageSize: ADMIN_DEVICE_PAGE_SIZE_MAX + 1 }).success,
    ).toBe(false);
  });
  it('rejects a non-positive page', () => {
    expect(AdminDeviceListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
  it('rejects stray keys (strict mode: a typo param is a 400, not a silent no-op)', () => {
    expect(AdminDeviceListQuerySchema.safeParse({ statuss: 'pending' }).success).toBe(false);
  });
});

describe('AdminDeviceListResponseSchema', () => {
  const row = {
    deviceId: GUID,
    operatorId: GUID,
    platform: 'android',
    bindingStatus: 'pending',
    attestationSecurityLevel: 'strongbox',
    attestationEnvironment: 'production',
    attestationVerifiedAt: '2026-07-19T00:00:00.000Z',
    bindingRevokedReason: null,
  };
  const envelope = {
    data: [row],
    page: 1,
    pageSize: ADMIN_DEVICE_PAGE_SIZE_DEFAULT,
    total: 1,
    totalPages: 1,
    hasMore: false,
  };
  it('accepts a well-formed paginated envelope of device rows', () => {
    expect(AdminDeviceListResponseSchema.safeParse(envelope).success).toBe(true);
  });
  it('requires the page-metadata fields (never paginate without a total)', () => {
    const { total: _omit, ...rest } = envelope;
    expect(AdminDeviceListResponseSchema.safeParse(rest).success).toBe(false);
  });
  it('rejects a row with an invalid binding status', () => {
    const bad = { ...envelope, data: [{ ...row, bindingStatus: 'approved' }] };
    expect(AdminDeviceListResponseSchema.safeParse(bad).success).toBe(false);
  });
  it('accepts null attestation fields (a device pending first attest)', () => {
    const nulls = {
      ...envelope,
      data: [
        {
          ...row,
          attestationSecurityLevel: null,
          attestationEnvironment: null,
          attestationVerifiedAt: null,
        },
      ],
    };
    expect(AdminDeviceListResponseSchema.safeParse(nulls).success).toBe(true);
  });
});
