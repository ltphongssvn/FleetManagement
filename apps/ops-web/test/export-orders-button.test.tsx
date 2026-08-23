// apps/ops-web/test/export-orders-button.test.tsx
//
// L1 for export-backup feature. ExportOrdersExcelButton is a client
// component: on click it calls the exportOrdersExcel server action and
// triggers a browser download by creating a Blob from the returned
// base64 + clicking a synthetic anchor. Failure surfaces a small inline
// error message; success returns to idle so the user can re-click.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const { exportOrdersExcel } = vi.hoisted(() => ({ exportOrdersExcel: vi.fn() }));
vi.mock('../src/features/dispatch/export-orders-excel.action', () => ({ exportOrdersExcel }));
import { ExportOrdersExcelButton } from '../src/features/dispatch/ExportOrdersExcelButton.js';
describe('@fleet/ops-web - ExportOrdersExcelButton', () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    exportOrdersExcel.mockReset();
  });
  it('renders the Vietnamese label "Xuất Excel"', () => {
    render(<ExportOrdersExcelButton />);
    expect(screen.getByRole('button', { name: /xu.t excel/i })).toBeInTheDocument();
  });
  it('on click: calls the action and triggers anchor download with the returned filename', async () => {
    exportOrdersExcel.mockResolvedValue({
      status: 'ok',
      bodyBase64: Buffer.from(new Uint8Array([0x50, 0x4b, 0x03, 0x04])).toString('base64'),
      filename: 'lenh-dieu-xe_t_2026-05-24_manual_deadbeef.xlsx',
    });
    const clickSpy = vi.fn();
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      clickSpy();
    });
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectURLSpy = vi.fn();
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      value: function patchedCreateObjectURL(b: Blob): string {
        createObjectURLSpy(b);
        return 'blob:mock';
      },
      configurable: true,
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      value: function patchedRevokeObjectURL(u: string): void {
        revokeObjectURLSpy(u);
      },
      configurable: true,
    });
    render(<ExportOrdersExcelButton />);
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => {
      expect(exportOrdersExcel).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    expect(createObjectURLSpy).toHaveBeenCalled();
    anchorClickSpy.mockRestore();
  });
  it('renders an error message when the action returns server_error', async () => {
    exportOrdersExcel.mockResolvedValue({ status: 'server_error', message: 'boom' });
    render(<ExportOrdersExcelButton />);
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/boom|l.i/i);
    });
  });
  it('renders an auth message when the action returns auth_required', async () => {
    exportOrdersExcel.mockResolvedValue({ status: 'auth_required' });
    render(<ExportOrdersExcelButton />);
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('renders Từ ngày / Đến ngày date inputs for the optional range', () => {
    render(<ExportOrdersExcelButton />);
    expect(screen.getByLabelText(/T. ng.y/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Đến ng.y/i)).toBeInTheDocument();
  });
  it('on click with both dates set: calls the action WITH the {from,to} range', async () => {
    exportOrdersExcel.mockResolvedValue({ status: 'auth_required' });
    render(<ExportOrdersExcelButton />);
    const from = screen.getByTestId('export-range-from');
    const to = screen.getByTestId('export-range-to');
    await userEvent.type(from, '2026-05-01');
    await userEvent.type(to, '2026-05-31');
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => {
      expect(exportOrdersExcel).toHaveBeenCalledWith({ from: '2026-05-01', to: '2026-05-31' });
    });
  });
  it('on click with no dates set: calls the action with no range (undefined)', async () => {
    exportOrdersExcel.mockResolvedValue({ status: 'auth_required' });
    render(<ExportOrdersExcelButton />);
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => {
      expect(exportOrdersExcel).toHaveBeenCalledWith(undefined);
    });
  });
});
