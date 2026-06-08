// apps/ops-web/test/admin-drivers-page-refresh-after-mutation.test.tsx
// outside-in strict TDD RED (L0): a new driver-vehicle assignment (and any
// admin CRUD: create/assign/revoke/delete) created in Quản lý tài xế & xe must
// make the dispatch form's Số xe / Tài xế dropdowns fresh WITHOUT a manual hard
// reload. Business invariant: admin mutations are immediately effective across
// related pages. Root cause being guarded: the Next.js client Router Cache
// holds the dispatch route's RSC payload; loadReferences() uses no-store (so no
// stale server cache), so the ONLY stale layer is the client Router Cache, which
// is cleared by router.refresh(). The admin page must call router.refresh()
// after each successful mutation so the Router Cache is busted and the dispatch
// form re-runs loadReferences() on next navigation. (2026 Next.js best practice:
// 'Router Cache needs router.refresh() or hard refresh to clear'; mirrors the
// existing dispatch create-order.action.ts router.refresh() pattern.)
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
const assignMock = vi.fn();
const enrollMock = vi.fn();
const revokeMock = vi.fn();
const removeMock = vi.fn();
const createMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { refresh: () => void } => ({ refresh: refreshMock }),
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
  // vehicles list for the assign dropdown
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items: [{ id: 'v1', label: '62H 99999' }] }),
  }) as never;
  globalThis.alert = vi.fn();
});

describe('AdminDriversPage refreshes Router Cache after a mutation', () => {
  it('calls router.refresh() after a successful driver-vehicle assignment', async () => {
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'v1' } });
    const udid = screen.getByPlaceholderText(/UDID|thiết bị/i);
    fireEvent.change(udid, { target: { value: 'UDID-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Phân công & đăng ký/i }));
    await waitFor(() => { expect(assignMock).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(refreshMock).toHaveBeenCalled(); });
  });

  it('still refreshes Router Cache when assignment succeeds but device enroll fails', async () => {
    // Root cause guard (MAI HIEN DIEU bug): assign + enroll were chained in one
    // try; assign committed the driver-vehicle assignment but enrollDevice threw
    // (device endpoint failed), the catch swallowed it, and router.refresh() was
    // never reached -> the new pair persisted yet the dispatch form dropdowns
    // stayed stale until a hard reload. The assignment's cache invalidation must
    // NOT depend on the independent enroll step (2026: execute independent
    // mutations independently; each invalidates on its own success).
    assignMock.mockResolvedValue({ assignmentId: 'asg-2' });
    enrollMock.mockRejectedValue(new Error('enroll endpoint 500'));
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'v1' } });
    const udid = screen.getByPlaceholderText(/UDID|thiết bị/i);
    fireEvent.change(udid, { target: { value: 'UDID-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Phân công & đăng ký/i }));
    await waitFor(() => { expect(assignMock).toHaveBeenCalledTimes(1); });
    // refresh MUST fire despite the enroll rejection
    await waitFor(() => { expect(refreshMock).toHaveBeenCalled(); });
  });
});
