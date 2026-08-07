// apps/ops-web/test/admin-reference-page-session-expired-redirect.test.tsx
// The Co so du lieu master-data sections must react to an idle-expired 401
// (refresh impossible) with the SAME silent-refresh navigation as Quan ly tai
// xe & xe, instead of rendering per-section dead-end banners -- on the initial
// load (list) AND on every write path (update / remove), since the fail() seam
// guards all four handlers. Non-auth failures keep the friendly banner (no
// navigation). isSessionExpired stays REAL; only the navigation side-effect is
// stubbed (partial mock). Write-path rows come from a resolved list; queries are
// scoped to the Khach hang section so the singular getByRole needs no cast.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiProblemError } from '@/features/errors/api-problem-error';
import type * as SessionRefreshNavigation from '@/features/auth/session-refresh-navigation';
import type * as ReferenceAdminClientModule from '@/features/admin/reference-admin-client';
const listMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
const { navigateToSessionRefreshMock } = vi.hoisted(() => ({ navigateToSessionRefreshMock: vi.fn() }));
vi.mock('@/features/auth/session-refresh-navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionRefreshNavigation>();
  return { ...actual, navigateToSessionRefresh: navigateToSessionRefreshMock };
});
vi.mock('@/features/admin/reference-admin-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ReferenceAdminClientModule>();
  return {
    ...actual,
    ReferenceAdminClient: class {
      list = listMock;
      create = vi.fn();
      update = updateMock;
      remove = removeMock;
    },
  };
});
import ReferenceAdminPage from '@/app/admin/reference/page';
const SESSION_EXPIRED = new ApiProblemError(401, 'UNAUTHORIZED', 'Phien dang nhap het han. Vui long dang nhap lai.');
function customerSection(): HTMLElement {
  const heading = screen.getAllByRole('heading', { name: 'Khách hàng' })[0];
  const section = heading?.closest('section') ?? null;
  if (section === null) throw new Error('no Khach hang section');
  return section;
}
beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
describe('ReferenceAdminPage on idle-expired session (401)', () => {
  it('navigates to the silent-refresh route instead of rendering dead-end banners', async () => {
    listMock.mockRejectedValue(SESSION_EXPIRED);
    render(<ReferenceAdminPage />);
    await waitFor(() => {
      expect(
        navigateToSessionRefreshMock.mock.calls.length,
        'expired session must trigger the silent-refresh navigation',
      ).toBeGreaterThanOrEqual(1);
    });
  });
  it('keeps the friendly per-section banner (no navigation) for non-auth failures', async () => {
    listMock.mockRejectedValue(
      new ApiProblemError(500, 'INTERNAL', 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.'),
    );
    render(<ReferenceAdminPage />);
    const banners = await screen.findAllByText(/Hệ thống đang gặp sự cố/);
    expect(banners.length).toBeGreaterThanOrEqual(1);
    expect(navigateToSessionRefreshMock).not.toHaveBeenCalled();
  });
  it('navigates on a session-expired failure while deleting a row', async () => {
    listMock.mockResolvedValue([{ id: 'c1', label: 'ACME', meta: {} }]);
    removeMock.mockRejectedValue(SESSION_EXPIRED);
    render(<ReferenceAdminPage />);
    const user = userEvent.setup();
    await screen.findAllByText('ACME');
    const sec = customerSection();
    await user.click(within(sec).getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    const dialog = await screen.findByRole('dialog');
    const accept = dialog.querySelector('[data-testid=confirm-accept]');
    if (accept === null) throw new Error('no confirm-accept');
    await user.click(accept as HTMLElement);
    await waitFor(() => { expect(navigateToSessionRefreshMock).toHaveBeenCalled(); });
  });
  it('navigates on a session-expired failure while saving an edited phone', async () => {
    listMock.mockResolvedValue([{ id: 'c1', label: 'ACME', meta: { phone: '0900000000' } }]);
    updateMock.mockRejectedValue(SESSION_EXPIRED);
    render(<ReferenceAdminPage />);
    const user = userEvent.setup();
    await screen.findAllByText('ACME');
    const sec = customerSection();
    await user.click(within(sec).getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    await user.click(within(sec).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => { expect(navigateToSessionRefreshMock).toHaveBeenCalled(); });
  });
});
