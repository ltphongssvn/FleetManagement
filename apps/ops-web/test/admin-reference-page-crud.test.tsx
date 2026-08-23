// apps/ops-web/test/admin-reference-page-crud.test.tsx
// ReferenceAdminPage (Quản lý dữ liệu điều phối) must NOT render per-row
// Sửa inline-rename buttons (T5). Xóa now lives in the per-row action menu
// (E1) and is gated by a confirm dialog rather than window.confirm. The page
// still lists rows + add form; each row exposes a Thao tác menu with Xóa.
// ReferenceAdminClient is mocked at module level so the page renders without
// the real fetch layer.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
vi.mock('@/features/admin/reference-admin-client', () => ({
  ReferenceAdminClient: class {
    list = listMock;
    create = createMock;
    update = updateMock;
    remove = removeMock;
  },
}));
import ReferenceAdminPage from '@/app/admin/reference/page';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  listMock.mockResolvedValue([
    { id: 'r1', label: 'ĐA NẴNG' },
    { id: 'r2', label: 'HÀ NỘI' },
  ]);
});
describe('ReferenceAdminPage CRUD UI (T5)', () => {
  it('does NOT render any Sửa inline-rename button', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('ĐA NẴNG');
    expect(screen.queryAllByRole('button', { name: /^Sửa$/ })).toHaveLength(0);
  });
  it('does NOT expose inline-edit Lưu controls', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('ĐA NẴNG');
    expect(screen.queryByRole('button', { name: /^Lưu$/ })).toBeNull();
  });
  it('exposes a Thao tác action menu per row (no always-visible Xóa)', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('ĐA NẴNG');
    expect(screen.queryByRole('button', { name: /^Xóa$/ })).toBeNull();
    const menus = screen.getAllByRole('button', { name: /Thao tác/ });
    expect(menus.length).toBeGreaterThanOrEqual(2);
  });
  it('Xóa via the menu opens a confirm dialog and calls client.remove', async () => {
    const user = userEvent.setup();
    removeMock.mockResolvedValue(undefined);
    render(<ReferenceAdminPage />);
    await screen.findAllByText('ĐA NẴNG');
    const firstMenu = screen.getAllByRole('button', { name: /Thao tác/ })[0];
    if (firstMenu === undefined) throw new Error('no action menu');
    await user.click(firstMenu);
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    const dialog = await screen.findByRole('dialog');
    expect(removeMock).not.toHaveBeenCalled();
    const accept = dialog.querySelector('[data-testid=confirm-accept]');
    if (accept === null) throw new Error('no confirm-accept');
    await user.click(accept as HTMLElement);
    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledWith('r1');
    });
  });
});
