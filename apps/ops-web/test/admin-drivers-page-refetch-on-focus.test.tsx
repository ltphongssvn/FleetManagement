// apps/ops-web/test/admin-drivers-page-refetch-on-focus.test.tsx
// RED-FIRST L1 (2026): Quản lý tài xế & xe must refetch its driver/assignment
// list when the tab regains focus, so a change made elsewhere (another
// dispatcher revokes/assigns a vehicle, another device) appears WITHOUT a
// manual reload. This page owns its data in client state (client.list() into a
// useReducer), NOT via RSC props, so a bare router.refresh() would not
// repopulate it — the page must re-run its own refresh() on focus. It does so
// via the shared useRefetchOnFocus hook (single source of truth for the
// behavior across all server-state surfaces).
//
// Assertion: after the initial load, a visibilitychange->visible re-invokes
// client.list() (listMock), and window focus likewise. Mirrors the mock shape
// of admin-drivers-page-refresh-after-mutation.test.tsx.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const refreshMock = vi.fn();
const { revalidateDispatchMock } = vi.hoisted(() => ({ revalidateDispatchMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: (): { refresh: () => void } => ({ refresh: refreshMock }),
}));
vi.mock('@/features/admin/revalidate-dispatch.action', () => ({
  revalidateDispatch: revalidateDispatchMock,
}));
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  listMock.mockResolvedValue([
    {
      driverId: 'd1',
      fullName: 'Driver Alpha',
      phone: '0900000001',
      operatorId: 'op-a',
      assignedVehicle: null,
      assignmentId: null,
      devices: [],
    },
  ]);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [{ id: 'v1', label: '62H 99999' }] }),
  }) as never;
  globalThis.alert = vi.fn();
});

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('AdminDriversPage refetches its list on tab focus / visibility', () => {
  it('re-runs client.list() when the tab becomes visible again', async () => {
    setVisibility('visible');
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    listMock.mockClear();

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      expect(
        listMock.mock.calls.length,
        'driver list must refetch when the tab returns to visible',
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('re-runs client.list() on window focus', async () => {
    setVisibility('visible');
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    listMock.mockClear();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(
        listMock.mock.calls.length,
        'driver list must refetch on window focus',
      ).toBeGreaterThanOrEqual(1);
    });
  });
});
