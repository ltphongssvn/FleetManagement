// apps/ops-web/test/dispatch-view-table-first-drawer.test.tsx
// P4 RED (T38): the Bang dieu phoi page is table-first. The Lenh dieu xe table
// is the primary surface; order creation lives behind a + Tao lenh dieu xe trigger
// that opens the NaturalLanguageCreateForm in an overlay/drawer, NOT stacked above
// the table. Root-cause fix for the form dominating the page above the fold.
//
// Heading queries use an EXACT-match anchor (^...$) to target the board h1
// (Lenh dieu xe) and NOT the create-form h2 (Lenh dieu xe - Tai thung), which
// otherwise both match a loose substring regex.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { DispatchBoardRoadRun } from '../src/features/dispatch/types';
afterEach(cleanup);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
const { DispatchView } = await import('../src/features/dispatch/DispatchView');
const refs = {
  drivers: [{ id: 'op-1', label: 'Driver 1' }],
  vehicles: [{ id: 'veh-1', label: '62H 05194' }],
  customers: [], cargoTypes: [], pickupWarehouses: [], deliveryWarehouses: [],
  driverVehicleAssignments: [{ operatorId: 'op-1', vehicleId: 'veh-1' }],
  nextOrderRef: '',
};
const initialRuns: readonly DispatchBoardRoadRun[] = [];
const boardHeading = /^L.nh .i.u xe$/i;
describe('DispatchView table-first + create-on-demand drawer', () => {
  it('renders the Lenh dieu xe table as the primary surface', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    expect(screen.getByRole('heading', { name: boardHeading })).toBeTruthy();
  });
  it('exposes a create trigger and keeps the create form closed initially', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    expect(screen.getByTestId('open-create-order')).toBeTruthy();
    expect(document.querySelector('form[data-testid=nl-create-order-form]')).toBeNull();
  });
  it('opens the natural-language create form when the trigger is clicked', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    fireEvent.click(screen.getByTestId('open-create-order'));
    expect(document.querySelector('form[data-testid=nl-create-order-form]')).not.toBeNull();
  });
  it('orders the table before the create trigger in the DOM (table-first)', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    const heading = screen.getByRole('heading', { name: boardHeading });
    const trigger = screen.getByTestId('open-create-order');
    const pos = heading.compareDocumentPosition(trigger);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
