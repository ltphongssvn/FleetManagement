// apps/ops-web/test/admin-drivers-page-refresh-after-mutation.test.tsx
// outside-in strict TDD RED (L0): a new driver-vehicle assignment (and any
// admin CRUD: create/assign/revoke/delete) created in Quan ly tai xe & xe must
// make the dispatch form Number-plate / Driver dropdowns fresh WITHOUT a manual
// hard reload. Business invariant: admin mutations are immediately effective
// across related pages. Root cause guarded: the Next.js client Router Cache
// holds the dispatch route RSC payload; loadReferences() uses no-store, so the
// only stale layer is the client Router Cache, cleared by router.refresh(), plus
// a cross-route revalidateDispatch server action. Interactions use userEvent
// with setup() (2026): fireEvent dispatches one synthetic event synchronously
// and does NOT flush React 19 async-transition act() work, so under CPU
// contention the waitFor poll can race the commit; user.* awaits the act-wrapped
// async work, removing the latent race independent of host load.
//
// SECOND race (this hardening): the number-plate <select> is populated by a
// SEPARATE global-fetch vehicle-list promise, not by listMock. findByText(
// Driver Alpha) only awaits the driver list, so under coverage-gate CPU
// contention selectOptions(v1) could fire before the option committed --
// TestingLibraryElementError: Value v1 not found. Await the OPTION itself
// (findByRole option, name 62H 99999) so the wait matches what a real user
// sees: a populated dropdown. Deterministic, host-load independent.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const listMock = vi.fn();
const assignMock = vi.fn();
const enrollMock = vi.fn();
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
    enrollDevice = enrollMock;
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
  enrollMock.mockResolvedValue({ deviceId: 'dev-1' });
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
  it('calls router.refresh() after a successful driver-vehicle assignment', async () => {
    const user = userEvent.setup();
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    // Wait for the vehicle option to load (separate fetch) before selecting.
    await screen.findByRole('option', { name: '62H 99999' });
    await user.selectOptions(screen.getByRole('combobox'), 'v1');
    await user.type(screen.getByPlaceholderText(/UDID|thiết bị/i), 'UDID-123');
    await user.click(screen.getByRole('button', { name: /Phân công & đăng ký/i }));
    await waitFor(() => { expect(assignMock).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(refreshMock).toHaveBeenCalled(); });
  });
  it('still refreshes Router Cache when assignment succeeds but device enroll fails', async () => {
    const user = userEvent.setup();
    assignMock.mockResolvedValue({ assignmentId: 'asg-2' });
    enrollMock.mockRejectedValue(new Error('enroll endpoint 500'));
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    // Wait for the vehicle option to load (separate fetch) before selecting.
    await screen.findByRole('option', { name: '62H 99999' });
    await user.selectOptions(screen.getByRole('combobox'), 'v1');
    await user.type(screen.getByPlaceholderText(/UDID|thiết bị/i), 'UDID-123');
    await user.click(screen.getByRole('button', { name: /Phân công & đăng ký/i }));
    await waitFor(() => { expect(assignMock).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(refreshMock).toHaveBeenCalled(); });
    await waitFor(() => { expect(revalidateDispatchMock).toHaveBeenCalled(); });
  });
});
