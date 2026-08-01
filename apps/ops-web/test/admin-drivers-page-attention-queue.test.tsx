// apps/ops-web/test/admin-drivers-page-attention-queue.test.tsx
// RED-first (L0) for contextual surfacing: drivers in Chua giao (no vehicle)
// or Chua dang ky (no device) states are MOVED into a Can xu ly (Action
// Required) queue section; fully configured drivers stay in the regular
// table. Move semantics (partition, never copy) is pinned by uniqueness:
// every driver name renders exactly once page-wide -- the existing suites
// (findByText, singular getByRole('combobox')) depend on it. Queue entries
// keep the full operational controls (Xoa, phone edit) so the CRUD and
// phone-edit suites keep passing over attention rows. Mock shape mirrors
// admin-drivers-page-crud.test.tsx.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
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
const DEVICE = { deviceId: 'dev-1', platform: 'ios', appVersion: '1.0.0', lastSeenAt: null };
const ALPHA_NO_VEHICLE = { driverId: 'd1', fullName: 'Driver Alpha', phone: '0900000001', operatorId: 'op-a', assignedVehicle: null, assignmentId: null, devices: [DEVICE] };
const BETA_NO_DEVICE = { driverId: 'd2', fullName: 'Driver Beta', phone: '0900000002', operatorId: 'op-b', assignedVehicle: { vehicleId: 'v9', plate: '51C-999.99' }, assignmentId: 'asg-9', devices: [] };
const GAMMA_COMPLETE = { driverId: 'd3', fullName: 'Driver Gamma', phone: '0900000003', operatorId: 'op-c', assignedVehicle: { vehicleId: 'v1', plate: '51C-111.11' }, assignmentId: 'asg-1', devices: [DEVICE] };
beforeEach(() => {
  listMock.mockResolvedValue([ALPHA_NO_VEHICLE, BETA_NO_DEVICE, GAMMA_COMPLETE]);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
  }) as never;
});
function queueSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Cần xử lý' });
}
describe('AdminDriversPage attention queue (contextual surfacing)', () => {
  it('renders the Cần xử lý queue section when attention rows exist', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.getByText('Cần xử lý')).toBeTruthy();
    expect(queueSection()).toBeTruthy();
  });
  it('queue lists exactly the attention drivers with their reason chips', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const q = queueSection();
    expect(within(q).getByText('Driver Alpha')).toBeTruthy();
    expect(within(q).getByText('Chưa giao')).toBeTruthy();
    expect(within(q).getByText('Driver Beta')).toBeTruthy();
    expect(within(q).getByText('Chưa đăng ký')).toBeTruthy();
    expect(within(q).queryByText('Driver Gamma')).toBeNull();
  });
  it('queue entries surface the next-action hints', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const q = queueSection();
    expect(within(q).getByText('Chọn số xe và bấm Phân công.')).toBeTruthy();
    expect(within(q).getByText('Thiết bị sẽ tự đăng ký khi tài xế đăng nhập ứng dụng.')).toBeTruthy();
  });
  it('moves (never copies): each driver name renders exactly once page-wide', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.getAllByText('Driver Alpha')).toHaveLength(1);
    expect(screen.getAllByText('Driver Beta')).toHaveLength(1);
    expect(screen.getAllByText('Driver Gamma')).toHaveLength(1);
  });
  it('configured drivers render outside the queue, in the regular table', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Gamma');
    expect(within(queueSection()).queryByText('Driver Gamma')).toBeNull();
    expect(screen.getByText('51C-111.11')).toBeTruthy();
  });
  it('renders no queue section when every driver is fully configured', async () => {
    listMock.mockResolvedValue([GAMMA_COMPLETE]);
    render(<AdminDriversPage />);
    await screen.findByText('Driver Gamma');
    expect(screen.queryByText('Cần xử lý')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Cần xử lý' })).toBeNull();
  });
  it('queue entries keep the operational controls (Thao tác menu + phone edit)', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const q = queueSection();
    // Xoa + Dat lai mat khau moved into the per-row Thao tac overflow menu.
    expect(within(q).queryByRole('button', { name: /^Xóa$/ })).toBeNull();
    expect(within(q).getAllByRole('button', { name: /Thao tác/ })).toHaveLength(2);
    expect(within(q).getByLabelText('Số điện thoại của Driver Alpha')).toBeTruthy();
  });
});
