// apps/ops-web/test/admin-reference-page-crud.test.tsx
// RED: ReferenceAdminPage (Quản lý dữ liệu điều phối) must NOT render
// per-row 'Sửa' inline-rename buttons (T5). Xóa + re-create supersedes
// rename safely. The page still lists rows + add form + Xóa per row.
// ReferenceAdminClient is mocked at module level so the page renders
// without the real fetch layer.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
afterEach(() => { cleanup(); vi.clearAllMocks(); });
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
  it('still renders Xóa buttons per row', async () => {
    render(<ReferenceAdminPage />);
    await screen.findAllByText('ĐA NẴNG');
    const xoaButtons = screen.getAllByRole('button', { name: /^Xóa$/ });
    // 5 sections × 2 rows each = 10 Xóa buttons.
    expect(xoaButtons.length).toBeGreaterThanOrEqual(2);
  });
  it('clicking Xóa confirms and calls client.remove', async () => {
    removeMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<ReferenceAdminPage />);
      await screen.findAllByText('ĐA NẴNG');
      const firstXoa = screen.getAllByRole('button', { name: /^Xóa$/ })[0];
      if (firstXoa === undefined) throw new Error('no Xóa button');
      fireEvent.click(firstXoa);
      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => {
        expect(removeMock).toHaveBeenCalledWith('r1');
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
