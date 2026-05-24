// apps/api/src/transport-orders/transport-orders-export.service.ts
//
// T1 (2026): exports the Lệnh điều xe (dispatch board) rows as an .xlsx
// Buffer using ExcelJS and records the export in transport_order_export_log.
//
// Tenant scope: rows are read from dispatch_board_projection filtered by
// operator.companyId — identical to DispatchController.getBoard. The
// export log row records (operator_id, company_id, trigger, day_key,
// row_count, sha256, filename) so the daily-backup invariant is auditable.
//
// Idempotency: for trigger='login'|'logout' a partial unique index on
// (company_id, operator_id, day_key, trigger) prevents duplicate ledger
// rows. The service detects the conflict via a pre-check SELECT and
// returns the existing row instead of inserting again. Manual exports
// bypass the check — users may export multiple times per day.
//
// Day key: VN timezone (UTC+7) calendar date as YYYY-MM-DD, computed in
// pure JS (no DB clock dependency) so unit tests are deterministic.
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { dispatchBoardProjection } from '../database/schema/projections.js';
import { transportOrderExportLog } from '../database/schema/transport-order-export-log.js';
import type { OperatorContext } from '../auth/operator-context.js';
export type ExportTrigger = 'manual' | 'login' | 'logout';
export interface ExportResult {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly sha256: string;
  readonly rowCount: number;
  readonly exportLogId: string;
  readonly trigger: ExportTrigger;
  readonly dayKey: string;
}
const HEADERS = ['Số lệnh', 'Trạng thái', 'Tài xế', 'Xe', 'Ngày dự kiến', 'Số điểm'] as const;
const PLANNED_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'medium',
  timeStyle: 'short',
});
function vnDayKey(now: Date = new Date()): string {
  // VN is UTC+7 year-round (no DST). Shift then read the UTC date parts.
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}
function tenantSlug(companyId: string): string {
  return companyId.replace(/-/g, '').slice(0, 8);
}
@Injectable()
export class TransportOrdersExportService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async exportAndLog(op: OperatorContext, trigger: ExportTrigger): Promise<ExportResult> {
    const dayKey = vnDayKey();
    // Auto triggers: check for existing ledger row first (idempotency).
    if (trigger === 'login' || trigger === 'logout') {
      const existing = await this.db
        .select()
        .from(transportOrderExportLog)
        .where(and(
          eq(transportOrderExportLog.companyId, op.companyId),
          eq(transportOrderExportLog.operatorId, op.operatorId),
          eq(transportOrderExportLog.dayKey, dayKey),
          eq(transportOrderExportLog.trigger, trigger),
        ))
        .limit(1);
      const head = existing[0];
      if (head !== undefined) {
        const buffer = await this.buildXlsxBufferForOp(op);
        return {
          buffer,
          filename: head.filename,
          sha256: head.sha256,
          rowCount: head.rowCount,
          exportLogId: head.exportLogId,
          trigger,
          dayKey,
        };
      }
    }
    const rows = await this.db
      .select()
      .from(dispatchBoardProjection)
      .where(eq(dispatchBoardProjection.companyId, op.companyId))
      .orderBy(asc(dispatchBoardProjection.plannedStartAt));
    const buffer = await this.buildXlsxBuffer(rows);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const filename =
      'lenh-dieu-xe_' + tenantSlug(op.companyId) + '_' + dayKey + '_' + trigger + '_' + sha256.slice(0, 8) + '.xlsx';
    const [inserted] = await this.db
      .insert(transportOrderExportLog)
      .values({
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
        operatorId: op.operatorId,
        trigger,
        dayKey,
        rowCount: rows.length,
        sha256,
        filename,
      })
      .returning();
    if (!inserted) throw new Error('transport_order_export_log insert failed');
    return {
      buffer,
      filename,
      sha256,
      rowCount: rows.length,
      exportLogId: inserted.exportLogId,
      trigger,
      dayKey,
    };
  }
  private async buildXlsxBufferForOp(op: OperatorContext): Promise<Buffer> {
    const rows = await this.db
      .select()
      .from(dispatchBoardProjection)
      .where(eq(dispatchBoardProjection.companyId, op.companyId))
      .orderBy(asc(dispatchBoardProjection.plannedStartAt));
    return this.buildXlsxBuffer(rows);
  }
  private async buildXlsxBuffer(
    rows: readonly (typeof dispatchBoardProjection.$inferSelect)[],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FleetManagement';
    wb.created = new Date(0); // deterministic for sha256 stability per export
    const ws = wb.addWorksheet('Lệnh điều xe');
    ws.addRow([...HEADERS]);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const primaryRef = r.transportOrderRefs[0] ?? '—';
      const planned = r.plannedStartAt ? PLANNED_FORMATTER.format(r.plannedStartAt) : '—';
      ws.addRow([
        primaryRef,
        r.state,
        r.assignedOperatorId ?? '—',
        r.assignedAssetId ?? '—',
        planned,
        r.stopCount,
      ]);
    }
    ws.columns.forEach((c) => { c.width = 18; });
    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab as ArrayBuffer);
  }
}
