// apps/ops-web/test/natural-language-create-form-behavior.test.tsx
// T38 coverage RED->GREEN: exercises the NaturalLanguageCreateForm logic the
// render-only contract test never reached -- the bidirectional driver<->vehicle
// pair auto-fill, the clear-field branches, and the useActionState-driven
// states (created -> onCreated bridge + So Lenh banner, api_error alert,
// invalid field errors, pending submit label).
//
// Combobox interaction follows the peer convention from
// create-order-form-driver-vehicle-autofill: type into the input to filter the
// listbox, then press Enter to commit (avoids the ResizeObserver click path).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type * as ReactModule from 'react';
import type { NaturalLanguageCreateForm as NLForm } from '@/features/dispatch/NaturalLanguageCreateForm';
const mockUseActionState = vi.fn();
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react');
  return { ...actual, useActionState: mockUseActionState };
});
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn() }));
afterEach(() => { cleanup(); });
beforeEach(() => { mockUseActionState.mockReturnValue([undefined, vi.fn(), false]); });
const OP_ALPHA = '00000000-0000-0000-0000-0000000000a1';
const OP_BETA = '00000000-0000-0000-0000-0000000000b2';
const VEH_AA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEH_BB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const drivers = [
  { id: OP_ALPHA, label: 'Driver Alpha' },
  { id: OP_BETA, label: 'Driver Beta' },
];
const vehicles = [
  { id: VEH_AA, label: 'AA-01' },
  { id: VEH_BB, label: 'BB-02' },
];
const driverVehicleAssignments = [
  { operatorId: OP_ALPHA, vehicleId: VEH_AA },
  { operatorId: OP_BETA, vehicleId: VEH_BB },
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
async function load(): Promise<{ NaturalLanguageCreateForm: typeof NLForm }> {
  return await import('@/features/dispatch/NaturalLanguageCreateForm');
}
describe('NaturalLanguageCreateForm - pair auto-fill', () => {
  it('auto-fills driver + assignedAssetId when a paired vehicle is picked', async () => {
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} vehicles={vehicles} driverVehicleAssignments={driverVehicleAssignments} locale={'en'} />);
    await pickVehicle('AA-01');
    expect(vehicleHidden()?.value).toBe('AA-01');
    expect(assetIdHidden()?.value).toBe(VEH_AA);
    expect(driverHidden()?.value).toBe(OP_ALPHA);
  });
  it('auto-fills vehicle + assignedAssetId when a paired driver is picked', async () => {
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} vehicles={vehicles} driverVehicleAssignments={driverVehicleAssignments} locale={'en'} />);
    await pickDriver('Driver Beta');
    expect(driverHidden()?.value).toBe(OP_BETA);
    expect(vehicleHidden()?.value).toBe('BB-02');
    expect(assetIdHidden()?.value).toBe(VEH_BB);
  });
  it('clearing the vehicle field resets assignedAssetId', async () => {
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} vehicles={vehicles} driverVehicleAssignments={driverVehicleAssignments} locale={'en'} />);
    await pickVehicle('AA-01');
    expect(assetIdHidden()?.value).toBe(VEH_AA);
    const input = document.getElementById('vehiclePlate') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(assetIdHidden()?.value).toBe('');
    expect(vehicleHidden()?.value).toBe('');
  });
  it('clearing the driver field takes the empty-input early exit', async () => {
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} vehicles={vehicles} driverVehicleAssignments={driverVehicleAssignments} locale={'en'} />);
    await pickDriver('Driver Alpha');
    expect(driverHidden()?.value).toBe(OP_ALPHA);
    const input = document.getElementById('assignedOperatorId') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(driverHidden()?.value).toBe('');
  });
});
describe('NaturalLanguageCreateForm - useActionState branches', () => {
  it('created: fires onCreated once and shows the So Lenh banner', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'created', externalRef: 'XTT.07-900', transportOrderId: 't-900' },
      vi.fn(), false,
    ]);
    const onCreated = vi.fn();
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} vehicles={vehicles} driverVehicleAssignments={driverVehicleAssignments} onCreated={onCreated} locale={'vi'} />);
    await waitFor(() => { expect(onCreated).toHaveBeenCalledTimes(1); });
    expect(screen.getByRole('status').textContent).toContain('XTT.07-900');
  });
  it('created without an onCreated prop does not throw', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'created', externalRef: 'XTT.07-901', transportOrderId: 't-901' },
      vi.fn(), false,
    ]);
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    expect(screen.getByRole('status').textContent).toContain('XTT.07-901');
  });
  it('api_error renders the alert banner', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'api_error', message: 'Loi API' }, vi.fn(), false,
    ]);
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    expect(screen.getByRole('alert').textContent).toContain('Loi API');
  });
  it('server_error renders the alert banner', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'server_error', message: 'Loi he thong' }, vi.fn(), false,
    ]);
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    expect(screen.getByRole('alert').textContent).toContain('Loi he thong');
  });
  it('invalid renders the per-field errors', async () => {
    mockUseActionState.mockReturnValue([
      { status: 'invalid', errors: { pickupWarehouses: 'Thieu kho nhan', assignedOperatorId: 'Thieu tai xe' } },
      vi.fn(), false,
    ]);
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    expect(screen.getByText('Thieu kho nhan')).toBeTruthy();
    expect(screen.getByText('Thieu tai xe')).toBeTruthy();
  });
  it('pending disables the submit button and shows the submitting label', async () => {
    mockUseActionState.mockReturnValue([undefined, vi.fn(), true]);
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'en'} />);
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /creating/i });
    expect(btn.disabled).toBe(true);
  });
  it('adds a delivery warehouse slot via the them-kho-giao control', async () => {
    const { NaturalLanguageCreateForm } = await load();
    render(<NaturalLanguageCreateForm drivers={drivers} locale={'vi'} />);
    const before = document.querySelectorAll('input[name^=deliveryWarehouse_]').length;
    fireEvent.click(screen.getByRole('button', { name: /th.m kho giao h.ng/i }));
    expect(document.querySelectorAll('input[name^=deliveryWarehouse_]').length).toBe(before + 1);
  });
});
