// apps/ops-web/test/export-orders-excel-button-filter.test.tsx
// RED (T67): the Xuat Excel BUTTON must pass the dispatcher ACTIVE search term
// and status tab into the export action.
//
// Root cause this closes: ExportOrdersExcelButton took NO props. It could not
// see the board filter even in principle, so however correct the contract, the
// API and the action became, the export still asked for the whole board. This
// is the last hop -- without it the fix never reaches a real dispatcher.
//
// The daily-backup invariant is preserved: with no search and no group the
// button sends undefined, exactly as before.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const exportOrdersExcel = vi.fn();
vi.mock('../src/features/dispatch/export-orders-excel.action', () => ({
  exportOrdersExcel: (filter?: unknown): unknown => exportOrdersExcel(filter) as unknown,
}));
const { ExportOrdersExcelButton } = await import(
  '../src/features/dispatch/ExportOrdersExcelButton'
);
describe('@fleet/ops-web - ExportOrdersExcelButton carries the board filter', () => {
  beforeEach(() => {
    exportOrdersExcel.mockReset();
    exportOrdersExcel.mockResolvedValue({ status: 'server_error', message: 'stop here' });
  });
  async function clickExport(): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: /Xu.t Excel/ }));
  }
  it('sends the active search term', async () => {
    render(<ExportOrdersExcelButton search='TAN KY' />);
    await clickExport();
    expect(exportOrdersExcel).toHaveBeenCalledWith({ search: 'TAN KY' });
  });
  it('sends the active status group', async () => {
    render(<ExportOrdersExcelButton group='cancelled' />);
    await clickExport();
    expect(exportOrdersExcel).toHaveBeenCalledWith({ group: 'cancelled' });
  });
  it('sends search and group together', async () => {
    render(<ExportOrdersExcelButton search='TRAU' group='active' />);
    await clickExport();
    expect(exportOrdersExcel).toHaveBeenCalledWith({ search: 'TRAU', group: 'active' });
  });
  it('sends undefined when no filter is active (daily-backup invariant)', async () => {
    render(<ExportOrdersExcelButton />);
    await clickExport();
    expect(exportOrdersExcel).toHaveBeenCalledWith(undefined);
  });
  it('omits an empty search term rather than sending a blank string', async () => {
    render(<ExportOrdersExcelButton search='' group='active' />);
    await clickExport();
    expect(exportOrdersExcel).toHaveBeenCalledWith({ group: 'active' });
  });
});
