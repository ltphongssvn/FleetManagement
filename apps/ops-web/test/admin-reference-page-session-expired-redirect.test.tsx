// apps/ops-web/test/admin-reference-page-session-expired-redirect.test.tsx
// RED (T11 idle-timeout arc, P7 sweep): the Co so du lieu page must react to
// an idle-expired 401 (refresh impossible) with the SAME silent-refresh
// navigation as Quan ly tai xe & xe, instead of rendering per-section
// dead-end banners. Non-auth failures keep the friendly banner (no
// navigation). isSessionExpired stays REAL; only the navigation side-effect
// is stubbed (partial mock -- house lesson from the drivers redirect suite).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ApiProblemError } from '@/features/errors/api-problem-error';
import type * as SessionRefreshNavigation from '@/features/auth/session-refresh-navigation';
import type * as ReferenceAdminClientModule from '@/features/admin/reference-admin-client';
const listMock = vi.fn();
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
      update = vi.fn();
      remove = vi.fn();
    },
  };
});
import ReferenceAdminPage from '@/app/admin/reference/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('ReferenceAdminPage on idle-expired session (401)', () => {
  it('navigates to the silent-refresh route instead of rendering dead-end banners', async () => {
    listMock.mockRejectedValue(
      new ApiProblemError(401, 'UNAUTHORIZED', 'Phien dang nhap het han. Vui long dang nhap lai.'),
    );
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
});
