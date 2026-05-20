// apps/ops-web/test/admin-drivers-page-crud.test.tsx
// RED: AdminDriversPage renders Sửa/Xóa per row matching the reference
// admin UI pattern. Clicking Sửa swaps the row into an inline editor;
// Lưu PATCHes via the client; Hủy reverts. Xóa confirms then DELETEs.
// AdminDriversClient is mocked at module level so the page renders without
// the real fetch layer.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const listMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
const createMock = vi.fn();
const assignMock = vi.fn();
const enrollMock = vi.fn();
const revokeMock = vi.fn();
vi.mock('@/features/admin/admin-drivers-client', () => ({
  AdminDriversClient: class {
    list = listMock;
    update = updateMock;
    remove = removeMock;
    create = createMock;
    assign = assignMock;
    enrollDevice = enrollMock;
    revoke = revokeMock;
  },
}));
import AdminDriversPage from '@/app/admin/drivers/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  listMock.mockResolvedValue([
    { driverId: 'd1', fullName: 'Driver Alpha', operatorId: 'op-a', assignedVehicle: null, assignmentId: null, devices: [] },
    { driverId: 'd2', fullName: 'Driver Beta',  operatorId: 'op-b', assignedVehicle: null, assignmentId: null, devices: [] },
  ]);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
  }) as never;
});
describe('AdminDriversPage CRUD UI', () => {
  it('renders a Sửa and Xóa button for each driver row', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const suaButtons = screen.getAllByRole('button', { name: 'Sửa' });
    const xoaButtons = screen.getAllByRole('button', { name: 'Xóa' });
    expect(suaButtons).toHaveLength(2);
    expect(xoaButtons).toHaveLength(2);
  });
  it('clicking Sửa shows an inline editor pre-filled with the driver name', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const suaButtons = screen.getAllByRole('button', { name: 'Sửa' });
    const firstSua = suaButtons[0];
    if (firstSua === undefined) throw new Error('no Sửa button');
    fireEvent.click(firstSua);
    const editInput = screen.getByDisplayValue('Driver Alpha');
    expect(editInput).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument();
  });
  it('clicking Lưu calls client.update with new name and refreshes', async () => {
    updateMock.mockResolvedValue(undefined);
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const suaButtons = screen.getAllByRole('button', { name: 'Sửa' });
    const firstSua = suaButtons[0];
    if (firstSua === undefined) throw new Error('no Sửa button');
    fireEvent.click(firstSua);
    const editInput = screen.getByDisplayValue('Driver Alpha');
    fireEvent.change(editInput, { target: { value: 'Renamed Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith('d1', { fullName: 'Renamed Alpha' });
    });
    // refresh after update
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });
  it('clicking Hủy exits edit mode without calling update', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const suaButtons = screen.getAllByRole('button', { name: 'Sửa' });
    const firstSua = suaButtons[0];
    if (firstSua === undefined) throw new Error('no Sửa button');
    fireEvent.click(firstSua);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
  });
  it('clicking Xóa confirms and then calls client.remove', async () => {
    removeMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<AdminDriversPage />);
      await screen.findByText('Driver Alpha');
      const xoaButtons = screen.getAllByRole('button', { name: 'Xóa' });
      const firstXoa = xoaButtons[0];
      if (firstXoa === undefined) throw new Error('no Xóa button');
      fireEvent.click(firstXoa);
      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(removeMock).toHaveBeenCalledWith('d1');
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });
  it('Xóa is a no-op when user cancels the confirm dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<AdminDriversPage />);
      await screen.findByText('Driver Alpha');
      const xoaButtons = screen.getAllByRole('button', { name: 'Xóa' });
      const firstXoa = xoaButtons[0];
      if (firstXoa === undefined) throw new Error('no Xóa button');
      fireEvent.click(firstXoa);
      expect(confirmSpy).toHaveBeenCalled();
      expect(removeMock).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
