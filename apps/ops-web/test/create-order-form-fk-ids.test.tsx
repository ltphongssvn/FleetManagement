// apps/ops-web/test/create-order-form-fk-ids.test.tsx
// T7 L1 RED -> GREEN: CreateOrderForm must submit FK ids (id, not label)
// for customer / cargo / pickup / delivery warehouses, so the action and
// API write side persist normalized FKs (referential integrity, ERP
// sync, projection joins). The driver field already submits id via
// submitValue='id' -- this spec extends the contract to all reference
// dropdowns.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CreateOrderForm } from '@/features/dispatch/CreateOrderForm';
afterEach(cleanup);
const drivers = [{ id: 'd-uuid-1', label: 'Driver One' }];
const vehicles = [{ id: 'v-uuid-1', label: 'V-1' }];
const customers = [{ id: 'c-uuid-1', label: 'Customer One' }];
const cargoTypes = [{ id: 'cg-uuid-1', label: 'Cargo A' }];
const pickupWarehouses = [{ id: 'pw-uuid-1', label: 'Pickup WH 1' }];
const deliveryWarehouses = [{ id: 'dw-uuid-1', label: 'Delivery WH 1' }];
const assignments = [{ operatorId: 'd-uuid-1', vehicleId: 'v-uuid-1' }];
const Q = String.fromCharCode(34);
function hidden(name: string): HTMLInputElement | null {
  return document.querySelector('input[type=' + Q + 'hidden' + Q + '][name=' + Q + name + Q + ']');
}
function requireInput(selector: string): Element {
  const el = document.querySelector(selector);
  if (el === null) throw new Error('input not found: ' + selector);
  return el;
}
describe('CreateOrderForm submits FK ids (T7)', () => {
  it('customer hidden input is named customer and submits the id', async () => {
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles} customers={customers}
      cargoTypes={cargoTypes} pickupWarehouses={pickupWarehouses}
      deliveryWarehouses={deliveryWarehouses} driverVehicleAssignments={assignments}
    />);
    const input = screen.getByLabelText(/khách hàng/i);
    const userEvent = (await import('@testing-library/user-event')).default;
    const ue = userEvent.setup();
    await ue.click(input);
    await ue.click(screen.getByRole('option', { name: 'Customer One' }));
    expect(hidden('customer')?.value).toBe('c-uuid-1');
  });
  it('cargo hidden input submits the cargo-type id', async () => {
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles} customers={customers}
      cargoTypes={cargoTypes} pickupWarehouses={pickupWarehouses}
      deliveryWarehouses={deliveryWarehouses} driverVehicleAssignments={assignments}
    />);
    const input = screen.getByLabelText(/tên hàng/i);
    const userEvent = (await import('@testing-library/user-event')).default;
    const ue = userEvent.setup();
    await ue.click(input);
    await ue.click(screen.getByRole('option', { name: 'Cargo A' }));
    expect(hidden('cargo')?.value).toBe('cg-uuid-1');
  });
  it('pickupWarehouse_1 hidden input submits the warehouse id', async () => {
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles} customers={customers}
      cargoTypes={cargoTypes} pickupWarehouses={pickupWarehouses}
      deliveryWarehouses={deliveryWarehouses} driverVehicleAssignments={assignments}
    />);
    const input = requireInput('input#pickupWarehouse_1');
    const userEvent = (await import('@testing-library/user-event')).default;
    const ue = userEvent.setup();
    await ue.click(input);
    await ue.click(screen.getByRole('option', { name: 'Pickup WH 1' }));
    expect(hidden('pickupWarehouse_1')?.value).toBe('pw-uuid-1');
  });
  it('deliveryWarehouse_1 hidden input submits the warehouse id', async () => {
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles} customers={customers}
      cargoTypes={cargoTypes} pickupWarehouses={pickupWarehouses}
      deliveryWarehouses={deliveryWarehouses} driverVehicleAssignments={assignments}
    />);
    const input = requireInput('input#deliveryWarehouse_1');
    const userEvent = (await import('@testing-library/user-event')).default;
    const ue = userEvent.setup();
    await ue.click(input);
    await ue.click(screen.getByRole('option', { name: 'Delivery WH 1' }));
    expect(hidden('deliveryWarehouse_1')?.value).toBe('dw-uuid-1');
  });
});
