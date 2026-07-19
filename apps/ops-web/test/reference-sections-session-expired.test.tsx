// apps/ops-web/test/reference-sections-session-expired.test.tsx
// Covers the merge seam: the T11 idle-timeout fail() branch (session-expired
// 401 -> navigateToSessionRefresh) threaded through the write handlers, as it
// runs through the NEW DataTable render. Develop tested fail() on the old
// <ul>/<li> render this branch replaced with the shared table, so after the
// merge the del()/saveEdit() session-expired branches (reference-sections
// lines 157/164) had no covering test. This pins them: a session-expired
// error on delete and on phone-save must route to the silent-refresh nav, not
// paint the inline error banner.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
const navigateMock = vi.fn();
const isExpiredMock = vi.fn();
vi.mock('@/features/admin/reference-admin-client', () => ({
  ReferenceAdminClient: class {
    list = listMock;
    create = createMock;
    update = updateMock;
    remove = removeMock;
  },
}));
vi.mock('@/features/auth/session-refresh-navigation', () => ({
  isSessionExpired: (e: unknown): boolean => isExpiredMock(e) as boolean,
  navigateToSessionRefresh: (): void => { navigateMock(); },
}));
import { ReferenceSection } from '@/features/admin/reference-sections';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  listMock.mockResolvedValue([{ id: 'c1', label: 'Acme', meta: { phone: '0901234567' } }]);
  window.confirm = vi.fn(() => true);
});
const CUSTOMERS = { segment: 'customers' as const, title: 'Khách hàng', addLabel: 'Thêm khách hàng' };
describe('reference section routes session-expired writes to silent refresh', () => {
  it('delete on a session-expired 401 navigates instead of showing the banner', async () => {
    const expired = new Error('session expired');
    removeMock.mockRejectedValue(expired);
    isExpiredMock.mockReturnValue(true);
    render(<ReferenceSection def={CUSTOMERS} />);
    const cell = await screen.findByRole('cell', { name: 'Acme' });
    const row = cell.closest('tr');
    if (row === null) throw new Error('no row');
    fireEvent.click(within(row).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => { expect(navigateMock).toHaveBeenCalledTimes(1); });
    expect(isExpiredMock).toHaveBeenCalledWith(expired);
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });
  it('phone-save on a session-expired 401 navigates instead of showing the banner', async () => {
    const expired = new Error('session expired');
    updateMock.mockRejectedValue(expired);
    isExpiredMock.mockReturnValue(true);
    render(<ReferenceSection def={CUSTOMERS} />);
    const cell = await screen.findByRole('cell', { name: 'Acme' });
    const row = cell.closest('tr');
    if (row === null) throw new Error('no row');
    fireEvent.click(within(row).getByRole('button', { name: 'Sửa SĐT' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => { expect(navigateMock).toHaveBeenCalledTimes(1); });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
  it('a NON-expired delete error shows the banner and does NOT navigate', async () => {
    removeMock.mockRejectedValue(new Error('boom'));
    isExpiredMock.mockReturnValue(false);
    render(<ReferenceSection def={CUSTOMERS} />);
    const cell = await screen.findByRole('cell', { name: 'Acme' });
    const row = cell.closest('tr');
    if (row === null) throw new Error('no row');
    fireEvent.click(within(row).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => { expect(screen.getByText('boom')).toBeInTheDocument(); });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
