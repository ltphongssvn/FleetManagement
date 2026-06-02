// apps/ops-web/test/admin-drivers-page-phone-edit.test.tsx
// outside-in strict TDD RED (L0): the roster must let an admin EDIT an existing
// driver's phone — the phone is the driver-app login identity, and until now it
// could only be set at create time. Business invariant: changing the phone here
// calls the update API with the driver's id + existing fullName + the NEW phone,
// so the credential a driver logs in with can be corrected without re-creating
// the driver (which would orphan their operatorId / assignments).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const listMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/features/admin/admin-drivers-client', () => ({
  AdminDriversClient: class {
    list = listMock;
    update = updateMock;
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
  ]);
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) }) as never;
});
describe('AdminDriversPage phone edit', () => {
  it('renders an editable phone input prefilled with the current phone', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const input = screen.getByLabelText('Số điện thoại của Driver Alpha');
    expect((input as HTMLInputElement).value).toBe('0900000001');
  });
  it('saving a new phone calls client.update with driverId + fullName + new phone', async () => {
    updateMock.mockResolvedValue(undefined);
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const input = screen.getByLabelText('Số điện thoại của Driver Alpha');
    fireEvent.change(input, { target: { value: '0911111111' } });
    const saveBtn = screen.getByRole('button', { name: 'Lưu SĐT của Driver Alpha' });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith('d1', { fullName: 'Driver Alpha', phone: '0911111111' });
    });
  });
});
