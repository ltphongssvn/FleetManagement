// apps/api/test/transport-orders-export.controller.test.ts
//
// L3 RED for export-backup feature. The controller exposes:
//   GET  /transport-orders/export.xlsx       -> manual download
//   POST /transport-orders/export/auto       -> {trigger: 'login'|'logout'}
// Both require JwtGuard + CurrentOperator. The manual endpoint streams
// the binary with the correct openxml content-type and the canonical
// Content-Disposition filename. The auto endpoint returns a small JSON
// summary (no binary) suitable for fire-and-forget calls from the
// login.action.ts / logout.action.ts server actions.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransportOrdersExportController } from '../src/transport-orders/transport-orders-export.controller.js';
import type { TransportOrdersExportService } from '../src/transport-orders/transport-orders-export.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';
interface MockRes {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  headers: Record<string, string>;
  body: Buffer | undefined;
}
function mockRes(): MockRes {
  const res: MockRes = {
    headers: {},
    body: undefined,
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockImplementation(function (this: unknown, k: string, v: string): unknown {
      res.headers[k.toLowerCase()] = v;
      return this;
    }),
    send: vi.fn().mockImplementation(function (this: unknown, b: Buffer): unknown {
      res.body = b;
      return this;
    }),
  };
  return res;
}
const op: OperatorContext = createOperatorContext();
describe('@fleet/api - TransportOrdersExportController', () => {
  let exportAndLog: ReturnType<typeof vi.fn>;
  let svc: TransportOrdersExportService;
  let ctl: TransportOrdersExportController;
  beforeEach(() => {
    exportAndLog = vi.fn();
    svc = { exportAndLog } as unknown as TransportOrdersExportService;
    ctl = new TransportOrdersExportController(svc);
  });
  it('GET export.xlsx streams binary with openxml content-type and attachment filename', async () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP magic
    exportAndLog.mockResolvedValue({
      buffer,
      filename: 'lenh-dieu-xe_t_2026-05-24_manual_deadbeef.xlsx',
      sha256: 'abc',
      rowCount: 3,
      exportLogId: 'log-1',
      trigger: 'manual',
      dayKey: '2026-05-24',
    });
    const res = mockRes();
    await ctl.exportXlsx({}, op, res as unknown as Parameters<typeof ctl.exportXlsx>[2]);
    expect(exportAndLog).toHaveBeenCalledWith(op, 'manual', undefined);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(
      'lenh-dieu-xe_t_2026-05-24_manual_deadbeef.xlsx',
    );
    expect(res.body).toBe(buffer);
  });

  it('GET export.xlsx with valid from/to threads the parsed range to the service', async () => {
    exportAndLog.mockResolvedValue({
      buffer: Buffer.from([0x50, 0x4b]),
      filename: 'f.xlsx',
      sha256: 'a',
      rowCount: 1,
      exportLogId: 'log-r',
      trigger: 'manual',
      dayKey: '2026-05-24',
    });
    const res = mockRes();
    await ctl.exportXlsx(
      { from: '2026-05-01', to: '2026-05-31' },
      op,
      res as unknown as Parameters<typeof ctl.exportXlsx>[2],
    );
    expect(exportAndLog).toHaveBeenCalledWith(op, 'manual', {
      from: '2026-05-01',
      to: '2026-05-31',
    });
  });
  it('GET export.xlsx rejects an inverted range (from > to)', async () => {
    const res = mockRes();
    await expect(
      ctl.exportXlsx(
        { from: '2026-05-31', to: '2026-05-01' },
        op,
        res as unknown as Parameters<typeof ctl.exportXlsx>[2],
      ),
    ).rejects.toThrow();
    expect(exportAndLog).not.toHaveBeenCalled();
  });
  it('GET export.xlsx rejects a malformed date', async () => {
    const res = mockRes();
    await expect(
      ctl.exportXlsx(
        { from: '2026-5-1', to: '2026-05-31' },
        op,
        res as unknown as Parameters<typeof ctl.exportXlsx>[2],
      ),
    ).rejects.toThrow();
  });
  it('GET export.xlsx with only one of from/to ignores the partial range (exports all)', async () => {
    exportAndLog.mockResolvedValue({
      buffer: Buffer.from([0x50]),
      filename: 'f.xlsx',
      sha256: 'a',
      rowCount: 1,
      exportLogId: 'log-p',
      trigger: 'manual',
      dayKey: '2026-05-24',
    });
    const res = mockRes();
    await ctl.exportXlsx(
      { from: '2026-05-01' },
      op,
      res as unknown as Parameters<typeof ctl.exportXlsx>[2],
    );
    expect(exportAndLog).toHaveBeenCalledWith(op, 'manual', undefined);
  });

  it('POST /export/auto with trigger=login delegates and returns ledger summary', async () => {
    exportAndLog.mockResolvedValue({
      buffer: Buffer.alloc(0),
      filename: 'f.xlsx',
      sha256: 'sha-x',
      rowCount: 2,
      exportLogId: 'log-login-1',
      trigger: 'login',
      dayKey: '2026-05-24',
    });
    const result = await ctl.exportAuto({ trigger: 'login' }, op);
    expect(exportAndLog).toHaveBeenCalledWith(op, 'login');
    expect(result).toEqual({
      exportLogId: 'log-login-1',
      trigger: 'login',
      dayKey: '2026-05-24',
      rowCount: 2,
      sha256: 'sha-x',
      filename: 'f.xlsx',
    });
  });
  it('POST /export/auto with trigger=logout works', async () => {
    exportAndLog.mockResolvedValue({
      buffer: Buffer.alloc(0),
      filename: 'f.xlsx',
      sha256: 's',
      rowCount: 0,
      exportLogId: 'log-logout-1',
      trigger: 'logout',
      dayKey: '2026-05-24',
    });
    await ctl.exportAuto({ trigger: 'logout' }, op);
    expect(exportAndLog).toHaveBeenCalledWith(op, 'logout');
  });
  it('POST /export/auto rejects invalid trigger value', async () => {
    await expect(ctl.exportAuto({ trigger: 'bogus' as 'login' }, op)).rejects.toThrow();
  });
  it('POST /export/auto rejects trigger=manual (manual goes through GET)', async () => {
    await expect(ctl.exportAuto({ trigger: 'manual' as 'login' }, op)).rejects.toThrow();
  });
});
