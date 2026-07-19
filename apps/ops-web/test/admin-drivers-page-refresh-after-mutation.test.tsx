// apps/ops-web/test/admin-drivers-page-refresh-after-mutation.test.tsx
// outside-in strict TDD (L0): a new driver-vehicle assignment (and any admin
// CRUD: create/assign/revoke/delete) created in Quan ly tai xe & xe must make
// the dispatch form Number-plate / Driver dropdowns fresh WITHOUT a manual hard
// reload. Business invariant: admin mutations are immediately effective across
// related pages. Root cause guarded: the Next.js client Router Cache holds the
// dispatch route RSC payload; loadReferences() uses no-store, so the only stale
// layer is the client Router Cache, cleared by router.refresh() (busts the
// CURRENT route cache), plus the cross-route revalidateDispatch server action.
//
// Merge resolution (origin/develop into fix/remove-manual-device-udid):
// WHAT is tested comes from HEAD -- device enrollment has been removed (T7
// self-enroll), so the dispatcher only assigns; the former chained
// assign+enroll scenario no longer exists and its obsolete test case was
// deleted together with the enroll UI.
// HOW it is driven comes from develop -- userEvent with setup() (2026):
// fireEvent dispatches one synthetic event synchronously and does NOT flush
// React 19 async-transition act() work, so under CPU contention the waitFor
// poll can race the commit; user.* awaits the act-wrapped async work, removing
// the latent race independent of host load.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const listMock = vi.fn();
const assignMock = vi.fn();
const revokeMock = vi.fn();
const removeMock = vi.fn();
const createMock = vi.fn();
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
    remove = removeMock;
    create = createMock;
    assign = assignMock;
    revoke = revokeMock;
  },
}));
import AdminDriversPage from '@/app/admin/drivers/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  listMock.mockResolvedValue([
    { driverId: 'd1', fullName: 'Driver Alpha', phone: '0900000001', operatorId: 'op-a', assignedVehicle: null, assignmentId: null, devices: [] },
  ]);
  assignMock.mockResolvedValue({ assignmentId: 'asg-1' });
  revokeMock.mockResolvedValue({ assignmentId: 'asg-1', revokedAt: '2026-01-01T00:00:00Z' });
  removeMock.mockResolvedValue(undefined);
  createMock.mockResolvedValue({ driverId: 'd9', operatorId: 'op-9' });
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [{ id: 'v1', label: '62H 99999' }] }),
  }) as never;
  globalThis.alert = vi.fn();
});
describe('AdminDriversPage refreshes Router Cache after a mutation', () => {
  it('busts both caches after a successful driver-vehicle assignment', async () => {
    const user = userEvent.setup();
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    // The driver list and the vehicle reference list are two INDEPENDENT async
    // loads. findByText above only settles the driver one, so at that instant the
    // select still holds just the placeholder option and selectOptions throws
    // 'Value v1 not found in options'. Await the option itself -- the narrowest
    // precondition the interaction actually depends on -- rather than an
    // arbitrary sleep or a waitFor around the click.
    await screen.findByRole('option', { name: '62H 99999' });
    await user.selectOptions(screen.getByRole('combobox'), 'v1');
    await user.click(screen.getByRole('button', { name: /Phân công/i }));
    await waitFor(() => { expect(assignMock).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(refreshMock).toHaveBeenCalled(); });
    await waitFor(() => { expect(revalidateDispatchMock).toHaveBeenCalled(); });
  });
});
