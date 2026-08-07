// apps/ops-web/test/drivers-admin-section-datatable.test.tsx
// RED->GREEN (t46): the configured-driver list in DriversAdminSection must
// render through the shared DataTable so it regains Tim kiem (search) and
// Trang X/Y pagination -- the two affordances the old UI had and that the
// hand-rolled table dropped -- WITHOUT losing any CRUD control (assign,
// revoke, save-phone, delete, reset-password). Rows here are CONFIGURED
// (assigned vehicle + registered device) so the attention queue is empty
// and the rows land in the DataTable, not the Can xu ly triage list.
//
// Fixtures are PARSED through AdminDriverRowSchema rather than cast with
// `as`. A cast blindfolds the compiler: if the wire contract gains a required
// field, a cast keeps this file green while production breaks. Parsing fails
// the factory instead -- and it immediately caught a real defect, the devices
// entry was missing the required `platform` field.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminDriverRowSchema, type AdminDriverRow } from '@fleet/sync-protocol';
import { DriversAdminSection, type DriversAdminClient } from '@/features/admin/DriversAdminSection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('@/features/admin/revalidate-dispatch.action', () => ({ revalidateDispatch: vi.fn().mockResolvedValue(undefined) }));

function makeConfiguredRow(id: string, name: string): AdminDriverRow {
  return AdminDriverRowSchema.parse({
    driverId: id,
    fullName: name,
    phone: '090' + id,
    operatorId: 'op-' + id,
    assignedVehicle: { vehicleId: 'v' + id, plate: '62H ' + id },
    assignmentId: 'a' + id,
    devices: [{ deviceId: 'dev-' + id, platform: 'android', appVersion: '1.0.0', lastSeenAt: null }],
  });
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

// Hermetic teardown: an un-restored global fetch stub leaks into every other
// file the parallel runner schedules next.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    const user = userEvent.setup();
    const rows = [makeConfiguredRow('1', 'Nguyen Van A'), makeConfiguredRow('2', 'Tran Van B')];
    render(<DriversAdminSection client={fakeClient(rows)} />);
    await waitFor(() => { expect(screen.getByText('Nguyen Van A')).toBeInTheDocument(); });
    await user.type(screen.getByTestId('datatable-search'), 'Tran');
    await waitFor(() => { expect(screen.queryByText('Nguyen Van A')).not.toBeInTheDocument(); });
    expect(screen.getByText('Tran Van B')).toBeInTheDocument();
  });

  it('drops the dead Phan cong xe column from the configured table', async () => {
    // A configured row is assigned BY CONSTRUCTION: partitionRows routes any
    // row whose classifyDriverAttention yields VEHICLE_UNASSIGNED to the Can
    // xu ly queue, and the API derives assignedVehicle and assignmentId from
    // the same active-assignment row (admin-drivers-list.service.ts). So the
    // assign cell could only ever render empty here once revoke moved into
    // the row menu -- the column was pure dead width. Assign controls remain
    // in the queue, where an unassigned driver actually needs them.
    render(<DriversAdminSection client={fakeClient([makeConfiguredRow('3', 'Le Van C')])} />);
    await waitFor(() => { expect(screen.getByText('Le Van C')).toBeInTheDocument(); });
    expect(screen.queryByRole('columnheader', { name: 'Phân công xe' })).toBeNull();
    expect(screen.queryByTestId('driver-assign-vehicle-3')).toBeNull();
    // the columns that carry real content survive
    expect(screen.getByRole('columnheader', { name: 'Xe được giao' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toBeInTheDocument();
  });

});
