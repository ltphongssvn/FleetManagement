// apps/ops-web/test/admin-drivers-page-refresh-after-mutation.test.tsx
// outside-in strict TDD (L0): a new driver-vehicle assignment created in
// Quan ly tai xe & xe must make the dispatch form dropdowns fresh WITHOUT a
// manual hard reload. The Next.js client Router Cache holds the dispatch
// route RSC payload; the admin page must call router.refresh() after a
// successful assignment (busts the CURRENT route cache) AND the
// revalidateDispatch server action (busts route / cross-route). Device
// enrollment has been removed (T7 self-enroll): the dispatcher only assigns,
// so the former chained assign+enroll MAI HIEN DIEU scenario no longer
// exists and its obsolete test case was deleted with the enroll UI.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
    render(<AdminDriversPage />);
    await screen.findByText('Driver Alpha');
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: /Phân công/i }));
    await waitFor(() => { expect(assignMock).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(refreshMock).toHaveBeenCalled(); });
    await waitFor(() => { expect(revalidateDispatchMock).toHaveBeenCalled(); });
  });
});
