// apps/ops-web/test/admin-drivers-page-crud.test.tsx
// AdminDriversPage CRUD UI tests.
//
// T5 update: the per-row 'Sửa' (inline rename) button is redundant. Xóa
// + re-create supersedes mid-list renames safely (idempotent, no stale
// state). Tests now assert: (a) no 'Sửa' button per row, (b) no inline
// editor / Lưu / Hủy controls, and (c) Xóa still works through the
// confirm dialog. AdminDriversClient is mocked at module level so the
// page renders without the real fetch layer.
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
  it('does NOT render a Sửa button for any driver row (T5)', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.queryAllByRole('button', { name: /^Sửa$/ })).toHaveLength(0);
  });
  it('does NOT expose inline-edit Lưu / Hủy controls (T5)', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.queryByRole('button', { name: /^Lưu$/ })).toBeNull();
    // 'Hủy' may still appear elsewhere (e.g. revoke prompt cancel), so
    // we only assert the inline-rename Lưu button is gone — that is the
    // definitive marker for the removed edit mode.
  });
  it('still renders a Xóa button per row', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.getAllByRole('button', { name: /^Xóa$/ })).toHaveLength(2);
  });
  it('clicking Xóa confirms and then calls client.remove', async () => {
    removeMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<AdminDriversPage />);
      await screen.findByText('Driver Alpha');
      const xoaButtons = screen.getAllByRole('button', { name: /^Xóa$/ });
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
      const xoaButtons = screen.getAllByRole('button', { name: /^Xóa$/ });
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
