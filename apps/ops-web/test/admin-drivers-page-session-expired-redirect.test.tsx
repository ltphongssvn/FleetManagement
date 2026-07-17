// apps/ops-web/test/admin-drivers-page-session-expired-redirect.test.tsx
// RED (T11 idle-timeout arc, D5 page layer): when the idle-expired list load
// dies with 401 (refresh impossible), Quan ly tai xe & xe must NOT render
// the dead-end error state (prod 2026-07-11: Loi: load failed) -- it must
// full-page navigate to /api/auth/refresh?next=<here>, where the server
// re-mints or lands cleanly on the public-origin /login?error=session_expired.
// Non-401 failures keep the existing friendly error state (no navigation).
// The navigation side-effect is the session-refresh-navigation SSOT seam
// (mocked here); the 401 predicate is real (ApiProblemError instanceof).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ApiProblemError } from '@/features/errors/api-problem-error';
import type * as SessionRefreshNavigation from '@/features/auth/session-refresh-navigation';
const listMock = vi.fn();
const refreshMock = vi.fn();
const { revalidateDispatchMock } = vi.hoisted(() => ({ revalidateDispatchMock: vi.fn() }));
const { navigateToSessionRefreshMock } = vi.hoisted(() => ({ navigateToSessionRefreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: (): { refresh: () => void } => ({ refresh: refreshMock }),
}));
vi.mock('@/features/admin/revalidate-dispatch.action', () => ({
  revalidateDispatch: revalidateDispatchMock,
}));
// PARTIAL mock: only the navigation side-effect is stubbed; isSessionExpired
// stays the REAL predicate (its instanceof branching is the behavior under test).
vi.mock('@/features/auth/session-refresh-navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionRefreshNavigation>();
  return { ...actual, navigateToSessionRefresh: navigateToSessionRefreshMock };
});
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
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [] }),
  }) as never;
  globalThis.alert = vi.fn();
});
describe('AdminDriversPage on idle-expired session (401)', () => {
  it('navigates to the silent-refresh route instead of rendering the error state', async () => {
    listMock.mockRejectedValue(new ApiProblemError(401, 'UNAUTHORIZED', 'GET /admin/drivers'));
    render(<AdminDriversPage />);
    await waitFor(() => {
      expect(
        navigateToSessionRefreshMock.mock.calls.length,
        'expired session must trigger the silent-refresh navigation',
      ).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/Lỗi:/)).toBeNull();
  });
  it('keeps the friendly error state (no navigation) for non-auth failures', async () => {
    listMock.mockRejectedValue(new ApiProblemError(500, 'INTERNAL', 'GET /admin/drivers'));
    render(<AdminDriversPage />);
    await screen.findByText(/Hệ thống đang gặp sự cố/);
    expect(navigateToSessionRefreshMock).not.toHaveBeenCalled();
  });
});
