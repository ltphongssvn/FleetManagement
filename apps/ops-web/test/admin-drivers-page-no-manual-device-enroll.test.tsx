// apps/ops-web/test/admin-drivers-page-no-manual-device-enroll.test.tsx
// outside-in strict TDD RED: the manual device-enroll UI must NOT exist.
// Root-cause removal: the manual pre-enroll path forced dispatchers to type a
// UDID (min length 1) and hardcoded platform=ios, which fabricated 22 fake
// device rows (audit: 3 duplicate-udid groups, all ios, all appVersion 0.0.0,
// 0 dependent sessions). Devices self-enroll via the app (T7); dispatchers
// never mint device identity. This test pins the ABSENCE of the enroll UI.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const listMock = vi.fn();
const enrollDeviceMock = vi.fn();
vi.mock('@/features/admin/admin-drivers-client', () => ({
  AdminDriversClient: class {
    list = listMock;
    update = vi.fn();
    remove = vi.fn();
    create = vi.fn();
    assign = vi.fn();
    enrollDevice = enrollDeviceMock;
    revoke = vi.fn();
  },
}));
import AdminDriversPage from '@/app/admin/drivers/page';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const DRIVER_UUID = 'd59a8731-d394-42d4-aeae-0f931a1bac55';
const OPERATOR_UUID = 'c07f39ce-5883-4bf3-9996-dc58e763b937';

beforeEach(() => {
  listMock.mockResolvedValue([
    { driverId: DRIVER_UUID, fullName: 'Driver Alpha', phone: '0900000001', operatorId: OPERATOR_UUID, assignedVehicle: null, assignmentId: null, devices: [] },
  ]);
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) }) as never;
});

describe('AdminDriversPage has no manual device-enroll UI', () => {
  it('renders no UDID / device-id input field', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const udidInputs = screen.queryAllByPlaceholderText(/UDID|m..? thi.t b.|thi.t b./i);
    expect(udidInputs).toHaveLength(0);
  });

  it('never calls enrollDevice on the client', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(enrollDeviceMock).not.toHaveBeenCalled();
  });

  it('still renders the driver roster (no collateral breakage)', async () => {
    render(<AdminDriversPage />);
    expect(await screen.findByText('Driver Alpha')).toBeTruthy();
  });
});
