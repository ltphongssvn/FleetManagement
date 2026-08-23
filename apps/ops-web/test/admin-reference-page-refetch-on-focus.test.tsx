// apps/ops-web/test/admin-reference-page-refetch-on-focus.test.tsx
// RED-FIRST L1 (2026): Quản lý dữ liệu điều phối (reference admin) must refetch
// its section lists when the tab regains focus, so a reference change made
// elsewhere (another dispatcher adds/removes a customer/cargo/vehicle/warehouse,
// or a vehicle becomes (un)paired) appears WITHOUT a manual reload. Each
// ReferenceSection owns its own rows via client.list() in client state, NOT via
// RSC props, so the section must re-run its own refresh() on focus — done via
// the shared useRefetchOnFocus hook (single source of truth for the behavior).
//
// The page renders 5 sections, so the initial mount calls list() 5 times; the
// assertion checks the call count INCREASES after a visibilitychange->visible
// (and after window focus), mirroring the conflict-consistency test's
// initialListCalls pattern.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

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
  listMock.mockResolvedValue([{ id: 'r1', label: 'TẤM' }]);
});

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('ReferenceAdminPage refetches its section lists on tab focus / visibility', () => {
  it('re-runs client.list() for sections when the tab becomes visible again', async () => {
    setVisibility('visible');
    render(<ReferenceAdminPage />);
    await screen.findAllByText('TẤM');
    const initialListCalls = listMock.mock.calls.length;

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      expect(
        listMock.mock.calls.length,
        'section lists must refetch when the tab returns to visible',
      ).toBeGreaterThan(initialListCalls);
    });
  });

  it('re-runs client.list() for sections on window focus', async () => {
    setVisibility('visible');
    render(<ReferenceAdminPage />);
    await screen.findAllByText('TẤM');
    const initialListCalls = listMock.mock.calls.length;

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(
        listMock.mock.calls.length,
        'section lists must refetch on window focus',
      ).toBeGreaterThan(initialListCalls);
    });
  });
});
