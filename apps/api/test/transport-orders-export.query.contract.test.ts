// apps/api/test/transport-orders-export.query.contract.test.ts
// RED (T67): GET /transport-orders-export.xlsx must thread the dispatcher
// ACTIVE search term and status tab through to the export service.
//
// Root cause this closes: the controller parsed ONLY from/to, so a dispatcher
// who searched and then pressed Xuat Excel silently received the ENTIRE board.
// 2026 export practice is what-you-see-is-what-you-export.
//
// Deliberate tightening vs the legacy suite (industry-confirmed, not taste): a
// HALF-specified range used to be silently ignored, exporting everything while
// looking bounded. That is the canonical query-parameter SILENT FAILURE
// anti-pattern -- a 200 OK carrying a wider row set than the caller asked for,
// with no signal anything differed. Fail-fast at the boundary is the 2026 rule,
// so it is now a 400 via ExportQuerySchema. No live caller sends a partial
// range: the ops-web action validates before building the query string.
//
// Zod note: the both-or-neither and from<=to checks live at OBJECT level, never
// as .optional().superRefine() on a field -- Zod 4.3 (#5589 exactOptional) stops
// surfacing field-level refinements when the key is absent, which would silently
// re-open this exact hole.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransportOrdersExportController } from '../src/transport-orders/transport-orders-export.controller.js';
import type { TransportOrdersExportService } from '../src/transport-orders/transport-orders-export.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { createOperatorContext } from '@fleet/test-fixtures';
interface MockRes {
  setHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}
function mockRes(): MockRes {
  return { setHeader: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
}
const op: OperatorContext = createOperatorContext();
describe('@fleet/api - export query threading', () => {
  let exportAndLog: ReturnType<typeof vi.fn>;
  let ctl: TransportOrdersExportController;
  function res(): Parameters<typeof ctl.exportXlsx>[2] {
    return mockRes() as unknown as Parameters<typeof ctl.exportXlsx>[2];
  }
  beforeEach(() => {
    exportAndLog = vi.fn().mockResolvedValue({
      buffer: Buffer.from([0x50, 0x4b]), filename: 'f.xlsx', sha256: 'a',
      rowCount: 1, exportLogId: 'log-1', trigger: 'manual', dayKey: '2026-07-30',
    });
    ctl = new TransportOrdersExportController(
      { exportAndLog } as unknown as TransportOrdersExportService,
    );
  });
  it('threads a bare search term to the service', async () => {
    await ctl.exportXlsx({ search: 'TAN KY NGUYEN' }, op, res());
    expect(exportAndLog).toHaveBeenCalledWith(op, 'manual', { search: 'TAN KY NGUYEN' });
  });
  it('threads the status group to the service', async () => {
    await ctl.exportXlsx({ group: 'cancelled' }, op, res());
    expect(exportAndLog).toHaveBeenCalledWith(op, 'manual', { group: 'cancelled' });
  });
  it('threads search, group and range together', async () => {
    await ctl.exportXlsx(
      { from: '2026-07-01', to: '2026-07-31', search: 'TRAU', group: 'active' }, op, res(),
    );
    expect(exportAndLog).toHaveBeenCalledWith(op, 'manual', {
      from: '2026-07-01', to: '2026-07-31', search: 'TRAU', group: 'active',
    });
  });
  it('passes undefined for an empty query (daily-backup invariant)', async () => {
    await ctl.exportXlsx({}, op, res());
    expect(exportAndLog).toHaveBeenCalledWith(op, 'manual', undefined);
  });
  it('rejects a half-specified range instead of silently exporting everything', async () => {
    await expect(ctl.exportXlsx({ from: '2026-07-01' }, op, res())).rejects.toThrow();
    expect(exportAndLog).not.toHaveBeenCalled();
  });
  it('rejects an inverted range', async () => {
    await expect(
      ctl.exportXlsx({ from: '2026-07-31', to: '2026-07-01' }, op, res()),
    ).rejects.toThrow();
    expect(exportAndLog).not.toHaveBeenCalled();
  });
  it('rejects an unknown status group', async () => {
    await expect(ctl.exportXlsx({ group: 'archived' }, op, res())).rejects.toThrow();
    expect(exportAndLog).not.toHaveBeenCalled();
  });
  it('rejects an empty search term', async () => {
    await expect(ctl.exportXlsx({ search: '' }, op, res())).rejects.toThrow();
    expect(exportAndLog).not.toHaveBeenCalled();
  });
  it('rejects a stray query key so a typo is a 400, not a full export', async () => {
    await expect(ctl.exportXlsx({ page: 2 }, op, res())).rejects.toThrow();
    expect(exportAndLog).not.toHaveBeenCalled();
  });
});
