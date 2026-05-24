// apps/ops-web/test/create-order-form-driver-vehicle-autofill.test.tsx
// CreateOrderForm: when Số xe (vehicle plate) is selected, Tài xế (driver)
// auto-fills via the driverVehicleAssignments mapping — and vice versa.
// The dispatcher binds 1 driver to 1 truck on the Đội xe page; this form
// therefore needs the mapping to be available so picking either dropdown
// reflects the bound pair without a second click.
//
// 2026 invariant: only paired drivers and vehicles are dispatchable. The
// form filters its option lists to operators / vehicles that appear in
// driverVehicleAssignments. The previous "manual override" branch
// (selecting an unpaired entity) is gone — those options no longer render.
// The hidden assignedAssetId input must stay in lock-step with the visible
// vehicle plate, because the API contract requires the vehicle uuid.
//
// Assertions target the ComboboxField hidden inputs, not the visible
// combobox labels. The driver field's ComboboxField uses submitValue='id',
// so the hidden input carries the operatorId — the actual server-bound
// contract. Visible labels are human-readable only and can drift from the
// submitted value. Peer test create-order-form-multi-pickup follows the
// same hidden-input querySelector convention.
//
// Combobox interaction: Headless UI 2.x in JSDOM uses ResizeObserver in
// click-based open paths but not in the change+Enter path. To keep tests
// polyfill-free at the click layer, we type into the input (filters the
// listbox to one candidate) then press Enter to commit the selection.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn() }));
afterEach(() => { cleanup(); });
const OP_ALPHA = '00000000-0000-0000-0000-0000000000a1';
const OP_BETA  = '00000000-0000-0000-0000-0000000000b2';
const OP_GAMMA = '00000000-0000-0000-0000-0000000000c3';
const VEH_AA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEH_BB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const VEH_CC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
// drivers / vehicles lists include both paired and unpaired entities. The
// form filters by driverVehicleAssignments so only the paired ones render.
const drivers = [
  { id: OP_ALPHA, label: 'Driver Alpha' },
  { id: OP_BETA,  label: 'Driver Beta'  },
  { id: OP_GAMMA, label: 'Driver Gamma (unpaired)' },
];
const vehicles = [
  { id: VEH_AA, label: 'AA-01' },
  { id: VEH_BB, label: 'BB-02' },
  { id: VEH_CC, label: 'CC-03 (unpaired)' },
];
const driverVehicleAssignments = [
  { operatorId: OP_ALPHA, vehicleId: VEH_AA },
  { operatorId: OP_BETA,  vehicleId: VEH_BB },
];
function vehicleHidden(): HTMLInputElement | null {
  return document.querySelector('input[type=hidden][name=vehiclePlate]');
}
function assetIdHidden(): HTMLInputElement | null {
  return document.querySelector('input[type=hidden][name=assignedAssetId]');
}
function driverHidden(): HTMLInputElement | null {
  return document.querySelector('input[type=hidden][name=assignedOperatorId]');
}
async function pickVehicle(label: string): Promise<void> {
  const input = document.getElementById('vehiclePlate') as HTMLInputElement;
  fireEvent.change(input, { target: { value: label } });
  await screen.findByRole('option', { name: label });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}
async function pickDriver(label: string): Promise<void> {
  const input = document.getElementById('assignedOperatorId') as HTMLInputElement;
  fireEvent.change(input, { target: { value: label } });
  await screen.findByRole('option', { name: label });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}
function typeVehicle(label: string): void {
  // Used when the option is expected NOT to be in the list. Just types
  // (synchronous), does not press Enter (no selection commit). Kept sync
  // because there is no listbox option to wait for.
  const input = document.getElementById('vehiclePlate') as HTMLInputElement;
  fireEvent.change(input, { target: { value: label } });
}
function typeDriver(label: string): void {
  const input = document.getElementById('assignedOperatorId') as HTMLInputElement;
  fireEvent.change(input, { target: { value: label } });
}
describe('CreateOrderForm - bidirectional driver vehicle auto-fill', () => {
  it('auto-fills the driver and assignedAssetId when a paired vehicle is selected', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickVehicle('AA-01');
    expect(vehicleHidden()?.value).toBe('AA-01');
    expect(assetIdHidden()?.value).toBe(VEH_AA);
    expect(driverHidden()?.value).toBe(OP_ALPHA);
  });
  it('auto-fills the vehicle and assignedAssetId when a paired driver is selected', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickDriver('Driver Beta');
    expect(driverHidden()?.value).toBe(OP_BETA);
    expect(vehicleHidden()?.value).toBe('BB-02');
    expect(assetIdHidden()?.value).toBe(VEH_BB);
  });
  it('does not surface unpaired vehicles in the dropdown options', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    // Typing the unpaired plate filters the listbox; no matching option
    // should appear because the form filtered it out of pairedVehicles.
    typeVehicle('CC-03 (unpaired)');
    expect(screen.queryByRole('option', { name: 'CC-03 (unpaired)' })).toBeNull();
    expect(assetIdHidden()?.value).toBe('');
    expect(driverHidden()?.value).toBe('');
  });
  it('does not surface unpaired drivers in the dropdown options', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    typeDriver('Driver Gamma (unpaired)');
    expect(screen.queryByRole('option', { name: 'Driver Gamma (unpaired)' })).toBeNull();
    expect(driverHidden()?.value).toBe('');
    expect(assetIdHidden()?.value).toBe('');
  });
  it('clearing the vehicle field resets assignedAssetId to empty', async () => {
    // The dispatcher may clear the vehicle picker after selecting one (typing
    // backspace to empty the input). The onVehicleChange handler is then
    // called with '' and must blank the hidden assignedAssetId so the form
    // doesn't submit a stale uuid bound to a now-empty vehicle plate.
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickVehicle('AA-01');
    expect(assetIdHidden()?.value).toBe(VEH_AA);
    // Clear by typing empty into the input directly. ComboboxField forwards
    // empty-string onChange events to the parent so we can hit that branch.
    const input = document.getElementById('vehiclePlate') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(assetIdHidden()?.value).toBe('');
    expect(vehicleHidden()?.value).toBe('');
  });
  it('clearing the driver field hits the onDriverChange empty-input branch', async () => {
    // Symmetric to the vehicle-clearing test: clearing the driver picker
    // (typing backspace to empty the input) triggers onDriverChange with
    // '' and must take the empty-input early-exit branch. The vehicle and
    // assetId fields are intentionally left as-is on driver clear — the
    // dispatcher may want to keep the vehicle pre-selected and pick a
    // different driver — but the driver hidden input must reflect ''.
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickDriver('Driver Alpha');
    expect(driverHidden()?.value).toBe(OP_ALPHA);
    const input = document.getElementById('assignedOperatorId') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(driverHidden()?.value).toBe('');
  });
  it('switching from one paired pair to another updates all three hidden fields together', async () => {
    // Regression guard: when the dispatcher swaps the driver from Alpha
    // to Beta after both fields are already populated, the auto-fill
    // must rewrite the vehicle plate AND the assignedAssetId, not leave
    // a stale vehicle uuid attached to a new driver.
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickDriver('Driver Alpha');
    expect(driverHidden()?.value).toBe(OP_ALPHA);
    expect(vehicleHidden()?.value).toBe('AA-01');
    expect(assetIdHidden()?.value).toBe(VEH_AA);
    await pickDriver('Driver Beta');
    expect(driverHidden()?.value).toBe(OP_BETA);
    expect(vehicleHidden()?.value).toBe('BB-02');
    expect(assetIdHidden()?.value).toBe(VEH_BB);
  });
});
