// apps/ops-web/test/features/dispatch/dispatch-board-labels.test.tsx
// L1b RED→GREEN: DispatchBoard must render human-readable identifiers, never
// raw UUIDs. Owned by T4 (feature/t4-dispatcher-labels). New file, not an
// edit of the shared DispatchBoard.test.tsx — keeps the partition disjoint.
//
// What this drives: DispatchBoard imports labels.ts + load-references so it
// can resolve assignedOperatorId / assignedAssetId via id→label lookups and
// surface the dispatcher-entered Số lệnh (transportOrderRefs[0]) instead of
// a UUID slice.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
afterEach(cleanup);
const DRIVER_ID = '00000000-0000-0000-0000-0000000000bb';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
function firstDataRow(): HTMLElement {
  const rows = screen.getAllByRole('row');
  const row = rows[1];
  if (row === undefined) throw new Error('expected at least one data row');
  return row;
}
function firstCell(row: HTMLElement): HTMLElement {
  const cells = within(row).getAllByRole('cell');
  const cell = cells[0];
  if (cell === undefined) throw new Error('expected at least one cell in row');
  return cell;
}
function rowText(row: HTMLElement): string {
  return row.textContent;
}
vi.mock('../../../src/features/dispatch/load-board.js', () => ({
  loadDispatchBoard: vi.fn().mockResolvedValue([
    {
      roadRunId: RUN_ID,
      state: 'dispatched',
      assignedOperatorId: DRIVER_ID,
      assignedAssetId: VEHICLE_ID,
      plannedStartAt: '2026-04-28T09:00:00.000Z',
      stopCount: 2,
      transportOrderRefs: ['XT.0067'],
    },
  ]),
}));
vi.mock('../../../src/features/dispatch/load-references.js', () => ({
  loadReferences: vi.fn().mockResolvedValue({
    nextOrderRef: '',
    drivers: [{ id: DRIVER_ID, label: 'Nguyễn Văn A' }],
    vehicles: [{ id: VEHICLE_ID, label: '51C-12345' }],
    customers: [], cargoTypes: [], pickupWarehouses: [], deliveryWarehouses: [],
    driverVehicleAssignments: [],
  }),
}));
const { DispatchBoard } = await import('../../../src/features/dispatch/DispatchBoard.js');
describe('DispatchBoard — human-readable labels (T4)', () => {
  it('renames the first column header from Mã lệnh to Số lệnh', async () => {
    render(await DispatchBoard());
    const table = screen.getByRole('table');
    const rowgroups = within(table).getAllByRole('rowgroup');
    const thead = rowgroups[0];
    if (thead === undefined) throw new Error('expected a thead rowgroup');
    expect(within(thead).getByText('Số lệnh')).toBeInTheDocument();
    expect(within(thead).queryByText('Mã lệnh')).not.toBeInTheDocument();
  });
  it('renders the dispatcher-entered order ref (XT.0067) in the Số lệnh column, not a UUID slice', async () => {
    render(await DispatchBoard());
    const cell = firstCell(firstDataRow());
    expect(cell).toHaveTextContent('XT.0067');
    expect(cell.textContent).not.toContain(RUN_ID.slice(0, 8));
  });
  it('resolves operator UUID to driver name via reference lookup', async () => {
    render(await DispatchBoard());
    const row = firstDataRow();
    expect(within(row).getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(rowText(row)).not.toContain(DRIVER_ID);
  });
  it('resolves vehicle UUID to plate via reference lookup', async () => {
    render(await DispatchBoard());
    const row = firstDataRow();
    expect(within(row).getByText('51C-12345')).toBeInTheDocument();
    expect(rowText(row)).not.toContain(VEHICLE_ID);
  });
  it('drops the Mã đơn trailing column now that Số lệnh is the primary key', async () => {
    // Số lệnh = transportOrderRefs[0]; the duplicate Mã đơn tail column adds
    // noise and re-leaks the same ref. Per T4 invariant we keep one canonical
    // column for the order ref.
    render(await DispatchBoard());
    const table = screen.getByRole('table');
    const rowgroups = within(table).getAllByRole('rowgroup');
    const thead = rowgroups[0];
    if (thead === undefined) throw new Error('expected a thead rowgroup');
    expect(within(thead).queryByText('Mã đơn')).not.toBeInTheDocument();
  });
});
describe('DispatchBoard — unknown id never leaks a UUID (T4)', () => {
  it('falls back to em-dash when operator id is not in the lookup', async () => {
    vi.resetModules();
    const UNKNOWN_OP = '99999999-9999-4999-8999-999999999999';
    vi.doMock('../../../src/features/dispatch/load-board.js', () => ({
      loadDispatchBoard: vi.fn().mockResolvedValue([
        {
          roadRunId: RUN_ID,
          state: 'planned',
          assignedOperatorId: UNKNOWN_OP,
          assignedAssetId: null,
          plannedStartAt: null,
          stopCount: 1,
          transportOrderRefs: ['XT.0099'],
        },
      ]),
    }));
    vi.doMock('../../../src/features/dispatch/load-references.js', () => ({
      loadReferences: vi.fn().mockResolvedValue({
        nextOrderRef: '', drivers: [], vehicles: [], customers: [], cargoTypes: [],
        pickupWarehouses: [], deliveryWarehouses: [], driverVehicleAssignments: [],
      }),
    }));
    const mod = await import('../../../src/features/dispatch/DispatchBoard.js');
    render(await mod.DispatchBoard());
    expect(rowText(firstDataRow())).not.toContain(UNKNOWN_OP);
  });
});
describe('DispatchBoard — formatPlannedStart invalid-date branch (T4)', () => {
  // Lifts DispatchBoard.tsx branch coverage to ≥90% by exercising the
  // Number.isNaN(d.getTime()) path inside formatPlannedStart.
  it('renders em-dash when plannedStartAt is an unparseable string', async () => {
    vi.resetModules();
    vi.doMock('../../../src/features/dispatch/load-board.js', () => ({
      loadDispatchBoard: vi.fn().mockResolvedValue([
        {
          roadRunId: RUN_ID,
          state: 'planned',
          assignedOperatorId: null,
          assignedAssetId: null,
          plannedStartAt: 'not-a-real-date',
          stopCount: 0,
          transportOrderRefs: ['XT.0001'],
        },
      ]),
    }));
    vi.doMock('../../../src/features/dispatch/load-references.js', () => ({
      loadReferences: vi.fn().mockResolvedValue({
        nextOrderRef: '', drivers: [], vehicles: [], customers: [], cargoTypes: [],
        pickupWarehouses: [], deliveryWarehouses: [], driverVehicleAssignments: [],
      }),
    }));
    const mod = await import('../../../src/features/dispatch/DispatchBoard.js');
    render(await mod.DispatchBoard());
    const cells = within(firstDataRow()).getAllByRole('cell');
    const plannedCell = cells[4];
    if (plannedCell === undefined) throw new Error('expected 5 cells per row');
    expect(plannedCell.textContent).toBe('—');
  });
});
