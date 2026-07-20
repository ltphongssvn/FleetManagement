// apps/ops-web/test/quick-assign-modal.test.tsx
// RED-first (Phase 1 -- Phan cong nhanh, modal UI). The modal replaces the
// per-row dropdown+button that repeated on every unassigned driver row: ONE
// dialog, pick an available vehicle by its human plate, confirm once.
//
// Contract honored here:
//  * vehicle-only (no udid/platform -- device enrollment removed, #302);
//  * no raw UUID reaches the dispatcher: options render the PLATE
//    (ReferenceItem.label) and carry the vehicleId (ReferenceItem.id) only as
//    the hidden option value; the assert proves the plate shows and the uuid
//    does NOT appear as visible text;
//  * submit is guarded by parseQuickAssignInput: confirm is disabled until a
//    real vehicle is chosen, so the blank-assignment error the old row allowed
//    cannot happen;
//  * onAssign receives the vehicleId (uuid) the parent client will POST with
//    the row driverId.
//
// Native <dialog> (2026 standard): browser-provided focus trap, Esc, backdrop.
// jsdom does not implement showModal/close, and a <dialog> whose open property
// is false keeps its contents OUT of the accessibility tree, so getByRole finds
// nothing (RTL #1106 / dom-testing-library #1173). The production component is
// correctly browser-only (imperative showModal/close, no open attribute -- both
// set on a native dialog is an InvalidStateError). The fix belongs in the TEST
// environment: stub showModal/close to reflect the open property the way a real
// browser does, so jsdom exposes the dialog contents. This keeps the component
// production-correct and the roles queryable.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QuickAssignModal } from '@/features/admin/QuickAssignModal';
const VEHICLE_A = '11111111-1111-1111-1111-111111111111';
const VEHICLE_B = '22222222-2222-2222-2222-222222222222';
const VEHICLES = [
  { id: VEHICLE_A, label: '62H 05194' },
  { id: VEHICLE_B, label: '51C 12345' },
];
beforeEach(() => {
  // Reflect the open property, mirroring a real browser: showModal() opens,
  // close() closes. This is what puts the dialog contents into the a11y tree.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.open = false;
  };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('QuickAssignModal (Phan cong nhanh)', () => {
  it('renders vehicle options by PLATE, never the raw uuid', () => {
    render(
      <QuickAssignModal
        open
        driverName='Nguyễn Văn A'
        vehicles={VEHICLES}
        onAssign={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: '62H 05194' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '51C 12345' })).toBeInTheDocument();
    expect(screen.queryByText(VEHICLE_A)).toBeNull();
    expect(screen.queryByText(VEHICLE_B)).toBeNull();
  });
  it('shows the driver name so the dispatcher knows who they are assigning', () => {
    render(
      <QuickAssignModal open driverName='Nguyễn Văn A' vehicles={VEHICLES} onAssign={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/Nguyễn Văn A/)).toBeInTheDocument();
  });
  it('disables confirm until a vehicle is chosen (blank-assignment guard)', () => {
    render(
      <QuickAssignModal open driverName='A' vehicles={VEHICLES} onAssign={vi.fn()} onClose={vi.fn()} />,
    );
    const confirm = screen.getByRole('button', { name: 'Phân công' });
    expect(confirm).toBeDisabled();
  });
  it('enables confirm once a vehicle is selected and calls onAssign with the uuid', async () => {
    const onAssign = vi.fn();
    render(
      <QuickAssignModal open driverName='A' vehicles={VEHICLES} onAssign={onAssign} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: VEHICLE_B } });
    const confirm = screen.getByRole('button', { name: 'Phân công' });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => { expect(onAssign).toHaveBeenCalledWith(VEHICLE_B); });
  });
  it('does NOT call onAssign when confirm is somehow clicked with no selection', () => {
    const onAssign = vi.fn();
    render(
      <QuickAssignModal open driverName='A' vehicles={VEHICLES} onAssign={onAssign} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Phân công' }));
    expect(onAssign).not.toHaveBeenCalled();
  });
  it('calls onClose from the Huy (cancel) button', () => {
    const onClose = vi.fn();
    render(
      <QuickAssignModal open driverName='A' vehicles={VEHICLES} onAssign={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('renders an empty-state note when no vehicles are available', () => {
    render(
      <QuickAssignModal open driverName='A' vehicles={[]} onAssign={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/Không có xe khả dụng/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phân công' })).toBeDisabled();
  });
});
