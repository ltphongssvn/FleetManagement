// apps/ops-web/test/export-orders-button.test.tsx
//
// L1 RED for export-backup feature. ExportOrdersExcelButton is a client
// component: on click it calls the exportOrdersExcel server action and
// triggers a browser download by creating a Blob from the returned
// base64 + clicking a synthetic anchor. Failure surfaces a small inline
// error message; success returns to idle so the user can re-click.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
const { exportOrdersExcel } = vi.hoisted(() => ({ exportOrdersExcel: vi.fn() }));
vi.mock('../src/features/dispatch/export-orders-excel.action', () => ({ exportOrdersExcel }));
import { ExportOrdersExcelButton } from '../src/features/dispatch/ExportOrdersExcelButton.js';
describe('@fleet/ops-web - ExportOrdersExcelButton', () => {
  afterEach(() => { cleanup(); });
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
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation(((tag: string) => {
      const real = Object.getPrototypeOf(document).createElement.call(document, tag) as HTMLElement;
      if (tag === 'a') {
        (real as HTMLAnchorElement).click = clickSpy;
      }
      return real;
    }) as typeof document.createElement);
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectURLSpy = vi.fn();
    Object.defineProperty(globalThis.URL, 'createObjectURL', { value: createObjectURLSpy, configurable: true });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', { value: revokeObjectURLSpy, configurable: true });
    render(<ExportOrdersExcelButton />);
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => expect(exportOrdersExcel).toHaveBeenCalledOnce());
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(createObjectURLSpy).toHaveBeenCalled();
    createElementSpy.mockRestore();
  });
  it('renders an error message when the action returns server_error', async () => {
    exportOrdersExcel.mockResolvedValue({ status: 'server_error', message: 'boom' });
    render(<ExportOrdersExcelButton />);
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/boom|l.i/i));
  });
  it('renders an auth message when the action returns auth_required', async () => {
    exportOrdersExcel.mockResolvedValue({ status: 'auth_required' });
    render(<ExportOrdersExcelButton />);
    await userEvent.click(screen.getByRole('button', { name: /xu.t excel/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
