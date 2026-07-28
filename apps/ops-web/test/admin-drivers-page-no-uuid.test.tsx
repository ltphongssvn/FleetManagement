// apps/ops-web/test/admin-drivers-page-no-uuid.test.tsx
// outside-in strict TDD RED (L0): no raw UUID may render in the driver roster.
// Business invariant: user-facing UI never exposes internal identifiers
// (operatorId / driverId UUIDs). The dispatcher identifies a driver by name +
// phone; the operatorId is a JWT-binding internal id with zero operational
// meaning and must not appear on screen.
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
const OPERATOR_UUID = 'c07f39ce-5883-4bf3-9996-dc58e763b937';
const DRIVER_UUID = 'd59a8731-d394-42d4-aeae-0f931a1bac55';
beforeEach(() => {
  listMock.mockResolvedValue([
    { driverId: DRIVER_UUID, fullName: 'Driver Alpha', phone: '0900000001', operatorId: OPERATOR_UUID, assignedVehicle: null, assignmentId: null, devices: [] },
  ]);
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) }) as never;
});
describe('AdminDriversPage hides raw UUIDs', () => {
  it('does NOT render the operatorId UUID anywhere on the page', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.queryByText(OPERATOR_UUID)).toBeNull();
  });
  it('does NOT render the driverId UUID anywhere on the page', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.queryByText(DRIVER_UUID)).toBeNull();
  });
  it('does NOT render a device UUID; shows a friendly registered status instead', async () => {
    listMock.mockResolvedValue([
      {
        driverId: DRIVER_UUID, fullName: 'Driver Beta', phone: '0900000002',
        operatorId: OPERATOR_UUID,
        assignedVehicle: { vehicleId: 'v-beta', plate: '62H 09999' },
        assignmentId: 'as-beta',
        devices: [{ deviceId: '6071e3fe-b083-45b2-9bae-ea5d8ea26c83' }],
      },
    ]);
    render(<AdminDriversPage />);
    await screen.findByText('Driver Beta');
    expect(screen.queryByText('6071e3fe-b083-45b2-9bae-ea5d8ea26c83')).toBeNull();
    expect(screen.getByText('Đã đăng ký')).toBeInTheDocument();
  });
});
