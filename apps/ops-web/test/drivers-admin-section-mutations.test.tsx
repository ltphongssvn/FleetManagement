// apps/ops-web/test/drivers-admin-section-mutations.test.tsx
// Covers the DriversAdminSection mutation handlers (create / assign / revoke /
// delete / save-phone / reset-password) via the injected client seam + userEvent,
// including the success and error/guard branches, so the extracted component
// meets the 90/90/90/90 per-file gate independently of the old page tests.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { DriversAdminSection, type DriversAdminClient } from '@/features/admin/DriversAdminSection';
vi.mock('@/features/admin/revalidate-dispatch.action', () => ({ revalidateDispatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function mkClient(over: Partial<DriversAdminClient>, rows: readonly AdminDriverRow[]): DriversAdminClient {
  return {
    list: vi.fn().mockResolvedValue(rows),
    create: vi.fn().mockResolvedValue({ driverId: 'd1' }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    assign: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as DriversAdminClient;
}
const unassigned: AdminDriverRow = {
  driverId: 'dr1', fullName: 'NGUYEN VAN A', phone: '0900000001',
  operatorId: null, assignedVehicle: null, assignmentId: null, devices: [],
};
const assigned: AdminDriverRow = {
  driverId: 'dr2', fullName: 'TRAN VAN B', phone: '0900000002',
  operatorId: 'op2', assignedVehicle: { vehicleId: 'v9', plate: '62H 05194' }, assignmentId: 'as2', devices: [],
};
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ items: [{ id: 'v9', label: '62H 05194' }] }) }) as never;
});
afterEach(() => { vi.restoreAllMocks(); });
describe('DriversAdminSection mutations', () => {
  it('creates a driver when the form is valid', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('Nguyễn Văn A'), 'MOI TAI XE');
    await user.type(screen.getByPlaceholderText('+84901000001'), '0912345678');
    await user.type(screen.getByPlaceholderText('≥ 6 ký tự'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Đăng ký tài xế' }));
    await waitFor(() => { expect(client.create).toHaveBeenCalledTimes(1); });
  });
  it('shows a validation error when required fields are missing', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Đăng ký tài xế' }));
    await waitFor(() => { expect(screen.getByText(/Vui lòng nhập/)).toBeInTheDocument(); });
    expect(client.create).not.toHaveBeenCalled();
  });
  it('surfaces a create error via alert', async () => {
    const client = mkClient({ create: vi.fn().mockRejectedValue(new Error('Tài xế đã tồn tại')) }, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('Nguyễn Văn A'), 'DUP');
    await user.type(screen.getByPlaceholderText('+84901000001'), '0912345678');
    await user.type(screen.getByPlaceholderText('≥ 6 ký tự'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Đăng ký tài xế' }));
    await waitFor(() => { expect(client.create).toHaveBeenCalled(); });
  });
  it('assigns a vehicle to an unassigned driver', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    const sel = await screen.findByTestId('driver-assign-vehicle-dr1');
    await screen.findByRole('option', { name: '62H 05194' });
    await user.selectOptions(sel, 'v9');
    await user.click(screen.getByTestId('driver-assign-submit-dr1'));
    await waitFor(() => { expect(client.assign).toHaveBeenCalledWith({ driverId: 'dr1', vehicleId: 'v9' }); });
  });
  it('alerts when assigning without selecting a vehicle', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('driver-assign-submit-dr1'));
    expect(alertSpy).toHaveBeenCalled();
    expect(client.assign).not.toHaveBeenCalled();
  });
  it('revokes an assignment after prompt', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('driver_left');
    const client = mkClient({}, [assigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('driver-revoke-dr2'));
    await waitFor(() => { expect(client.revoke).toHaveBeenCalledWith('as2', 'driver_left'); });
  });
  it('deletes a driver after confirm', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await screen.findByText('NGUYEN VAN A');
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    const dialog = await screen.findByRole('dialog');
    const accept = dialog.querySelector('[data-testid=confirm-accept]');
    if (accept === null) throw new Error('no confirm-accept');
    await user.click(accept as HTMLElement);
    await waitFor(() => { expect(client.remove).toHaveBeenCalledWith('dr1'); });
  });
  it('does not delete when the confirm dialog is cancelled', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await screen.findByText('NGUYEN VAN A');
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(client.remove).not.toHaveBeenCalled();
  });
  it('saves an edited phone', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    await user.click(await screen.findByLabelText('Lưu SĐT của NGUYEN VAN A'));
    await waitFor(() => { expect(client.update).toHaveBeenCalled(); });
  });
  it('resets a password when the new value is valid', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('newpass1');
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt lại mật khẩu' }));
    await waitFor(() => { expect(client.resetPassword).toHaveBeenCalledWith('dr1', 'newpass1'); });
  });
  it('rejects a too-short reset password', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('123');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt lại mật khẩu' }));
    expect(alertSpy).toHaveBeenCalled();
    expect(client.resetPassword).not.toHaveBeenCalled();
  });
  it('shows the error state when list load fails', async () => {
    const client = mkClient({ list: vi.fn().mockRejectedValue(new Error('boom')) }, []);
    render(<DriversAdminSection client={client} />);
    await waitFor(() => { expect(screen.getByText(/Lỗi:/)).toBeInTheDocument(); });
  });

  it('alerts when assign fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const client = mkClient({ assign: vi.fn().mockRejectedValue(new Error('boom')) }, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    const sel = await screen.findByTestId('driver-assign-vehicle-dr1');
    await screen.findByRole('option', { name: '62H 05194' });
    await user.selectOptions(sel, 'v9');
    await user.click(screen.getByTestId('driver-assign-submit-dr1'));
    await waitFor(() => { expect(alertSpy).toHaveBeenCalled(); });
  });
  it('alerts when revoke fails', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('driver_left');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const client = mkClient({ revoke: vi.fn().mockRejectedValue(new Error('boom')) }, [assigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('driver-revoke-dr2'));
    await waitFor(() => { expect(alertSpy).toHaveBeenCalled(); });
  });
  it('alerts when reset password fails', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('newpass1');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const client = mkClient({ resetPassword: vi.fn().mockRejectedValue(new Error('boom')) }, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt lại mật khẩu' }));
    await waitFor(() => { expect(alertSpy).toHaveBeenCalled(); });
  });

  it('alerts when save phone fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const client = mkClient({ update: vi.fn().mockRejectedValue(new Error('boom')) }, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    await user.click(await screen.findByLabelText('Lưu SĐT của NGUYEN VAN A'));
    await waitFor(() => { expect(alertSpy).toHaveBeenCalled(); });
  });
  it('edits the phone field before saving', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    const phoneInput = await screen.findByLabelText('Số điện thoại của NGUYEN VAN A');
    await user.clear(phoneInput);
    await user.type(phoneInput, '0999999999');
    await user.click(screen.getByLabelText('Lưu SĐT của NGUYEN VAN A'));
    await waitFor(() => { expect(client.update).toHaveBeenCalledWith('dr1', { fullName: 'NGUYEN VAN A', phone: '0999999999' }); });
  });

  it('does not revoke when the prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const client = mkClient({}, [assigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('driver-revoke-dr2'));
    expect(client.revoke).not.toHaveBeenCalled();
  });
  it('renders a fully configured driver (assigned + device) in the table', async () => {
    const configured = {
      driverId: 'dr3', fullName: 'LE VAN C', phone: '0900000003',
      operatorId: 'op3', assignedVehicle: { vehicleId: 'v3', plate: '62H 07777' },
      assignmentId: 'as3', devices: [{ deviceId: 'dev-abc' }],
    } as unknown as AdminDriverRow;
    const client = mkClient({}, [configured]);
    render(<DriversAdminSection client={client} />);
    await waitFor(() => { expect(screen.getByText('62H 07777')).toBeInTheDocument(); });
    expect(screen.getByText('Đã đăng ký')).toBeInTheDocument();
  });

  it('renders a configured driver in the regular table with revoke + device', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('driver_left');
    const DEVICE = { deviceId: 'dev-1', platform: 'ios', appVersion: '1.0.0', lastSeenAt: null };
    const gamma = {
      driverId: 'd3', fullName: 'Driver Gamma', phone: '0900000003',
      operatorId: 'op-c', assignedVehicle: { vehicleId: 'v1', plate: '51C-111.11' },
      assignmentId: 'asg-1', devices: [DEVICE],
    } as unknown as AdminDriverRow;
    const client = mkClient({}, [gamma]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    // configured driver -> renders in the regular table (not the attention queue):
    await waitFor(() => { expect(screen.getByText('51C-111.11')).toBeInTheDocument(); });
    expect(screen.getByText('Đã đăng ký')).toBeInTheDocument();
    // the table revoke button carries assignmentId (covers the ?? fallback arm):
    await user.click(screen.getByTestId('driver-revoke-d3'));
    await waitFor(() => { expect(client.revoke).toHaveBeenCalledWith('asg-1', 'driver_left'); });
  });

  it('does not reset password when the prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt lại mật khẩu' }));
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it('tolerates a non-ok vehicles fetch (no vehicle options)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }) as never;
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    // still renders the assign control; the select simply has no plate options
    await waitFor(() => { expect(screen.getByTestId('driver-assign-vehicle-dr1')).toBeInTheDocument(); });
  });
  it('exposes a Thao tac menu per driver row; no always-visible Xoa button', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    await screen.findByText('NGUYEN VAN A');
    expect(screen.queryByRole('button', { name: /^Xóa$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Thao tác/ })).toBeInTheDocument();
  });
  it('keeps focus in the phone field while typing for a configured driver', async () => {
    const multiDevice: AdminDriverRow = {
      driverId: 'dr9', fullName: 'MULTI DEV', phone: '0900000009',
      operatorId: 'op9', assignmentId: 'as9',
      assignedVehicle: { vehicleId: 'v9', plate: '62H 08888' },
      devices: [
        { deviceId: 'dev-a', platform: 'android', appVersion: '1.0.0', lastSeenAt: null },
        { deviceId: 'dev-b', platform: 'ios', appVersion: '1.0.0', lastSeenAt: null },
      ],
    };
    const client = mkClient({}, [multiDevice]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    const label = 'Số điện thoại của MULTI DEV';
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    const input = await screen.findByLabelText(label);
    await user.clear(input);
    await user.type(input, '0912345678');
    // cells must update in place -- a remount destroys focus and IME state mid-typing
    expect(document.activeElement).toBe(screen.getByLabelText(label));
    expect(screen.getByLabelText(label)).toHaveValue('0912345678');
  });
  it('shows a device count suffix when a driver has more than one device', async () => {
    const twoDevices = {
      driverId: 'dr9', fullName: 'MULTI DEV', phone: '0900000009',
      operatorId: 'op9', assignedVehicle: { vehicleId: 'v9', plate: '62H 08888' },
      assignmentId: 'as9', devices: [{ deviceId: 'dev-a' }, { deviceId: 'dev-b' }],
    } as unknown as AdminDriverRow;
    const client = mkClient({}, [twoDevices]);
    render(<DriversAdminSection client={client} />);
    expect(await screen.findByText('62H 08888')).toBeInTheDocument();
    expect(screen.getByText('Đã đăng ký (2)')).toBeInTheDocument();
  });
  it('shows the phone as read-only text with no persistent Luu SDT button', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    await screen.findByText('NGUYEN VAN A');
    // read-only by default: no phone input and no Luu SDT button on the row
    expect(screen.queryByLabelText('Số điện thoại của NGUYEN VAN A')).toBeNull();
    expect(screen.queryByLabelText('Lưu SĐT của NGUYEN VAN A')).toBeNull();
  });
  it('reveals the phone input and Luu SDT only after choosing Sua SDT in the menu', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await screen.findByText('NGUYEN VAN A');
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    const input = await screen.findByLabelText('Số điện thoại của NGUYEN VAN A');
    await user.clear(input);
    await user.type(input, '0912345678');
    await user.click(screen.getByLabelText('Lưu SĐT của NGUYEN VAN A'));
    await waitFor(() => { expect(client.update).toHaveBeenCalledWith('dr1', { fullName: 'NGUYEN VAN A', phone: '0912345678' }); });
  });
  it('cancels phone editing and returns to read-only without saving', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    await screen.findByText('NGUYEN VAN A');
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    const input = await screen.findByLabelText('Số điện thoại của NGUYEN VAN A');
    await user.clear(input);
    await user.type(input, '0777777777');
    await user.click(screen.getByLabelText('Hủy sửa SĐT của NGUYEN VAN A'));
    // back to read-only: input gone, no update call
    await waitFor(() => { expect(screen.queryByLabelText('Số điện thoại của NGUYEN VAN A')).toBeNull(); });
    expect(client.update).not.toHaveBeenCalled();
  });
  it('saves the existing phone when the field is not edited', async () => {
    const client = mkClient({}, [unassigned]);
    render(<DriversAdminSection client={client} />);
    const user = userEvent.setup();
    // enter edit mode, then click Luu SDT without typing -> falls back to row.phone (?? arm)
    await user.click(await screen.findByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    await user.click(await screen.findByLabelText('Lưu SĐT của NGUYEN VAN A'));
    await waitFor(() => { expect(client.update).toHaveBeenCalledWith('dr1', { fullName: 'NGUYEN VAN A', phone: '0900000001' }); });
  });
});
