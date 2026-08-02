// apps/ops-web/test/drivers-admin-section-datatable.test.tsx
// RED->GREEN (t46): the configured-driver list in DriversAdminSection must
// render through the shared DataTable so it regains Tim kiem (search) and
// Trang X/Y pagination -- the two affordances the old UI had and that the
// hand-rolled table dropped -- WITHOUT losing any CRUD control (assign,
// revoke, save-phone, delete, reset-password). Rows here are CONFIGURED
// (assigned vehicle + registered device) so the attention queue is empty
// and the rows land in the DataTable, not the Can xu ly triage list.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { DriversAdminSection, type DriversAdminClient } from '@/features/admin/DriversAdminSection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('@/features/admin/revalidate-dispatch.action', () => ({ revalidateDispatch: vi.fn().mockResolvedValue(undefined) }));

function makeConfiguredRow(id: string, name: string): AdminDriverRow {
  return {
    driverId: id,
    fullName: name,
    phone: '090' + id,
    assignedVehicle: { vehicleId: 'v' + id, plate: '62H ' + id },
    assignmentId: 'a' + id,
    devices: [{ deviceId: 'dev-' + id, appVersion: '1.0.0', lastSeenAt: null }],
  } as AdminDriverRow;
}


function fakeClient(rows: readonly AdminDriverRow[]): DriversAdminClient {
  return {
    list: vi.fn().mockResolvedValue(rows),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    assign: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
  } as unknown as DriversAdminClient;
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) }) as unknown as typeof fetch);
});

describe('DriversAdminSection configured list via DataTable', () => {
  it('renders the DataTable search box on the configured driver list', async () => {
    render(<DriversAdminSection client={fakeClient([makeConfiguredRow('1', 'Nguyen Van A')])} />);
    await waitFor(() => { expect(screen.getByText('Nguyen Van A')).toBeInTheDocument(); });
    expect(screen.getByTestId('datatable-search')).toBeInTheDocument();
  });

  it('keeps the reset-password CRUD control (in the Thao tac menu) for each configured row', async () => {
    const user = userEvent.setup();
    render(<DriversAdminSection client={fakeClient([makeConfiguredRow('1', 'Nguyen Van A')])} />);
    await waitFor(() => { expect(screen.getByText('Nguyen Van A')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    expect(await screen.findByRole('menuitem', { name: 'Đặt lại mật khẩu' })).toBeInTheDocument();
  });

  it('paginates when configured drivers exceed one page', async () => {
    const rows = Array.from({ length: 12 }, (_v, i) => makeConfiguredRow(String(i + 1), 'Driver ' + String(i + 1)));
    render(<DriversAdminSection client={fakeClient(rows)} />);
    await waitFor(() => { expect(screen.getByText('Driver 1')).toBeInTheDocument(); });
    expect(screen.getByTestId('datatable-page-info')).toBeInTheDocument();
    expect(screen.getByTestId('datatable-next')).toBeInTheDocument();
  });

  it('filters the configured list through the DataTable search box', async () => {
    const rows = [makeConfiguredRow('1', 'Nguyen Van A'), makeConfiguredRow('2', 'Tran Van B')];
    render(<DriversAdminSection client={fakeClient(rows)} />);
    await waitFor(() => { expect(screen.getByText('Nguyen Van A')).toBeInTheDocument(); });
    fireEvent.change(screen.getByTestId('datatable-search'), { target: { value: 'Tran' } });
    await waitFor(() => { expect(screen.queryByText('Nguyen Van A')).not.toBeInTheDocument(); });
    expect(screen.getByText('Tran Van B')).toBeInTheDocument();
  });

});
