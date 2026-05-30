// apps/ops-web/test/create-order-form-hydration-signal.test.tsx
// T7 hydration-ready contract (RED-first): the dispatch form renders
// server-side before React hydrates. An E2E that fills #plannedStartAt
// after only the (SSR) heading is visible races hydration and the value
// is dropped (Playwright docs / Microsoft #27759 / BrowserStack 2026:
// wait for the interactive version, not the static HTML). The fix is a
// deterministic readiness signal the client sets on mount. This spec
// asserts the form root carries data-hydrated='true' once mounted.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { CreateOrderForm } from '@/features/dispatch/CreateOrderForm';
afterEach(cleanup);
const drivers = [{ id: 'd-uuid-1', label: 'Driver One' }];
const vehicles = [{ id: 'v-uuid-1', label: 'V-1' }];
const customers = [{ id: 'c-uuid-1', label: 'Customer One' }];
const cargoTypes = [{ id: 'cg-uuid-1', label: 'Cargo A' }];
const pickupWarehouses = [{ id: 'pw-uuid-1', label: 'Pickup WH 1' }];
const deliveryWarehouses = [{ id: 'dw-uuid-1', label: 'Delivery WH 1' }];
const assignments = [{ operatorId: 'd-uuid-1', vehicleId: 'v-uuid-1' }];
describe('CreateOrderForm exposes a hydration-ready signal (T7)', () => {
  it('sets data-hydrated=true on the form root after mount', async () => {
    render(<CreateOrderForm
      drivers={drivers} vehicles={vehicles} customers={customers}
      cargoTypes={cargoTypes} pickupWarehouses={pickupWarehouses}
      deliveryWarehouses={deliveryWarehouses} driverVehicleAssignments={assignments}
    />);
    const form = screen.getByTestId('create-order-form');
    await waitFor(() => {
      expect(form.getAttribute('data-hydrated')).toBe('true');
    });
  });
});
