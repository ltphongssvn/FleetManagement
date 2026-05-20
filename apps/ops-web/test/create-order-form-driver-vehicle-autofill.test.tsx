// apps/ops-web/test/create-order-form-driver-vehicle-autofill.test.tsx
// CreateOrderForm: when Số xe (vehicle plate) is selected, Tài xế (driver)
// auto-fills via the driverVehicleAssignments mapping — and vice versa.
// The dispatcher binds 1 driver to 1 truck on the Đội xe page; this form
// therefore needs the mapping to be available so picking either dropdown
// reflects the bound pair without a second click.
//
// Branches covered:
//   - selecting a vehicle whose operatorId is in the mapping auto-fills the driver
//   - selecting a driver whose operatorId is in the mapping auto-fills the vehicle
//   - a vehicle/driver not present in the mapping does not auto-fill the other
//   - selecting an unpaired vehicle after a paired driver was set does NOT
//     clobber the existing driver value (and the symmetric reverse)
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
describe('CreateOrderForm - bidirectional driver vehicle auto-fill', () => {
  it('auto-fills the driver when a paired vehicle is selected', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickVehicle('AA-01');
    expect(vehicleHidden()?.value).toBe('AA-01');
    expect(driverHidden()?.value).toBe(OP_ALPHA);
  });
  it('auto-fills the vehicle when a paired driver is selected', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickDriver('Driver Beta');
    expect(driverHidden()?.value).toBe(OP_BETA);
    expect(vehicleHidden()?.value).toBe('BB-02');
  });
  it('does NOT auto-fill the driver for an unpaired vehicle', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickVehicle('CC-03 (unpaired)');
    expect(vehicleHidden()?.value).toBe('CC-03 (unpaired)');
    expect(driverHidden()?.value).toBe('');
  });
  it('does NOT auto-fill the vehicle for an unpaired driver', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickDriver('Driver Gamma (unpaired)');
    expect(driverHidden()?.value).toBe(OP_GAMMA);
    expect(vehicleHidden()?.value).toBe('');
  });
  it('selecting an unpaired vehicle after a paired driver was set does not clobber the driver', async () => {
    // Regression guard: the auto-fill must only WRITE to the other field
    // when a pair is found. An unpaired selection must early-exit without
    // touching the other field's already-set value.
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    // Step 1: pick a paired driver — both fields populate.
    await pickDriver('Driver Alpha');
    expect(driverHidden()?.value).toBe(OP_ALPHA);
    expect(vehicleHidden()?.value).toBe('AA-01');
    // Step 2: switch to an unpaired vehicle. Vehicle field updates;
    // driver field must stay as Driver Alpha.
    await pickVehicle('CC-03 (unpaired)');
    expect(vehicleHidden()?.value).toBe('CC-03 (unpaired)');
    expect(driverHidden()?.value).toBe(OP_ALPHA);
  });
  it('selecting an unpaired driver after a paired vehicle was set does not clobber the vehicle', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles}
      driverVehicleAssignments={driverVehicleAssignments} locale='en' />);
    await pickVehicle('BB-02');
    expect(vehicleHidden()?.value).toBe('BB-02');
    expect(driverHidden()?.value).toBe(OP_BETA);
    await pickDriver('Driver Gamma (unpaired)');
    expect(driverHidden()?.value).toBe(OP_GAMMA);
    expect(vehicleHidden()?.value).toBe('BB-02');
  });
});
