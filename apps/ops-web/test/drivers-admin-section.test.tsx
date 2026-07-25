// apps/ops-web/test/drivers-admin-section.test.tsx
// The shared DriversAdminSection provides the full driver CRUD surface (register
// form + assign/revoke/delete/phone/reset) extracted from the old /admin/drivers
// page so the Co so du lieu page can host it in place of the read-only
// DriversSection. Client is injected (fake list resolves) so the XState machine
// reaches ready and the register form renders. VN copy is immutable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { DriversAdminSection, type DriversAdminClient } from '@/features/admin/DriversAdminSection';
function fakeClient(rows: readonly AdminDriverRow[]): DriversAdminClient {
  return {
    list: vi.fn().mockResolvedValue(rows),
    create: vi.fn().mockResolvedValue({ driverId: 'd1' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    assign: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
  } as unknown as DriversAdminClient;
}
const ONE_ROW: AdminDriverRow[] = [{
  driverId: 'dr1', fullName: 'NGUYEN VAN A', phone: '0900000001',
  operatorId: null, assignedVehicle: null, assignmentId: null, devices: [],
}];
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: () => Promise.resolve({ items: [] }),
  }) as never;
});
describe('DriversAdminSection', () => {
  it('renders the register-driver form heading once loaded', async () => {
    render(<DriversAdminSection client={fakeClient(ONE_ROW)} />);
    expect(await screen.findByRole('heading', { name: 'Đăng ký tài xế mới' })).toBeInTheDocument();
  });
  it('renders the register submit button once loaded', async () => {
    render(<DriversAdminSection client={fakeClient(ONE_ROW)} />);
    expect(await screen.findByRole('button', { name: 'Đăng ký tài xế' })).toBeInTheDocument();
  });
  it('renders an assign-vehicle control for an unassigned driver', async () => {
    const rows: AdminDriverRow[] = [{
      driverId: 'dr1', fullName: 'NGUYEN VAN A', phone: '0900000001',
      operatorId: null, assignedVehicle: null, assignmentId: null, devices: [],
    }];
    render(<DriversAdminSection client={fakeClient(rows)} />);
    expect(await screen.findByTestId('driver-assign-vehicle-dr1')).toBeInTheDocument();
  });
});
