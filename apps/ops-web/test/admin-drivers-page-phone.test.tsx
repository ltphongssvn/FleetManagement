// apps/ops-web/test/admin-drivers-page-phone.test.tsx
// outside-in strict TDD RED (L0): the Quản lý tài xế & xe table must show each
// driver's Số điện thoại — the phone is the driver-app login identity, so an
// admin must see/verify it. Business invariant: the phone an admin registers is
// the phone the driver app authenticates with; the admin list surfaces it.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
const listMock = vi.fn();
vi.mock('@/features/admin/admin-drivers-client', () => ({
  AdminDriversClient: class {
    list = listMock;
    update = vi.fn();
    remove = vi.fn();
    create = vi.fn();
    assign = vi.fn();
    enrollDevice = vi.fn();
    revoke = vi.fn();
  },
}));
import AdminDriversPage from '@/app/admin/drivers/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  listMock.mockResolvedValue([
    { driverId: 'd1', fullName: 'Driver Alpha', phone: '0900000001', operatorId: 'op-a', assignedVehicle: null, assignmentId: null, devices: [] },
    { driverId: 'd2', fullName: 'Driver Beta', phone: '0900000002', operatorId: 'op-b', assignedVehicle: null, assignmentId: null, devices: [] },
  ]);
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) }) as never;
});
describe('AdminDriversPage phone column', () => {
  it('renders a Số điện thoại column header', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.getByText('Số điện thoại')).toBeTruthy();
  });
  it('renders each driver phone number', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.getByText('0900000001')).toBeTruthy();
    expect(screen.getByText('0900000002')).toBeTruthy();
  });
});
