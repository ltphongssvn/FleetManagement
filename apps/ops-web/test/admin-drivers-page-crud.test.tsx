// apps/ops-web/test/admin-drivers-page-crud.test.tsx
// AdminDriversPage CRUD UI tests.
//
// T5 update: the per-row Sua (inline rename) button is redundant. Xoa
// + re-create supersedes mid-list renames safely (idempotent, no stale
// state). E1-drivers update: Xoa + Dat lai mat khau now live in the per-row
// Thao tac overflow menu (RowActionMenu), with Xoa gated by an accessible
// confirm dialog rather than window.confirm. Tests assert: (a) no Sua button
// per row, (b) no inline editor / Luu / Huy controls, and (c) Xoa still works
// through the menu + confirm dialog. AdminDriversClient is mocked at module
// level so the page renders without the real fetch layer.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  listMock.mockResolvedValue([
    {
      driverId: 'd1',
      fullName: 'Driver Alpha',
      operatorId: 'op-a',
      assignedVehicle: null,
      assignmentId: null,
      devices: [],
    },
    {
      driverId: 'd2',
      fullName: 'Driver Beta',
      operatorId: 'op-b',
      assignedVehicle: null,
      assignmentId: null,
      devices: [],
    },
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
  });
  it('exposes a Thao tác menu per row; no always-visible Xóa button', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    expect(screen.queryByRole('button', { name: /^Xóa$/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Thao tác/ })).toHaveLength(2);
  });
  it('Xóa via the menu opens a confirm dialog and then calls client.remove', async () => {
    removeMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const menus = screen.getAllByRole('button', { name: /Thao tác/ });
    const firstMenu = menus[0];
    if (firstMenu === undefined) throw new Error('no action menu');
    await user.click(firstMenu);
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    const dialog = await screen.findByRole('dialog');
    const accept = dialog.querySelector('[data-testid=confirm-accept]');
    if (accept === null) throw new Error('no confirm-accept');
    await user.click(accept as HTMLElement);
    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledWith('d1');
    });
  });
  it('Xóa is a no-op when the confirm dialog is cancelled', async () => {
    const user = userEvent.setup();
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const menus = screen.getAllByRole('button', { name: /Thao tác/ });
    const firstMenu = menus[0];
    if (firstMenu === undefined) throw new Error('no action menu');
    await user.click(firstMenu);
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(removeMock).not.toHaveBeenCalled();
  });
});
