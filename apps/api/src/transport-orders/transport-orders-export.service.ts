// apps/api/src/transport-orders/transport-orders-export.service.ts
//
// T1 (2026): exports the Lệnh điều xe (dispatch board) rows as an .xlsx
// Buffer using ExcelJS and records the export in transport_order_export_log.
//
// COLUMN PARITY (2026): the exported workbook contains EXACTLY the columns the
// on-screen Lệnh điều xe table shows, in the same order:
//   Số lệnh | Khách hàng | Tài xế | Xe | Ngày dự kiến | Số điểm |
//   Điểm nhận hàng 1..4 | Kho giao hàng 1
// The Khách hàng cell carries the customer name and, when present, the phone on
// a second line (the on-screen cell stacks name over phone; Excel is flat so the
// phone is folded into that one cell — it is NOT a separate column). Each
// Điểm/Kho cell carries the per-stop status string the board renders: 'Chưa tới'
// until the stop is arrived/departed, else 'Đã hoàn thành <vn-date>'; em-dash for
// a slot with no stop. The customer + per-stop data is joined at read time using
// the SAME joins DispatchController.getBoard uses (road_run_transport_order ->
// transport_order -> customer; road_run_transport_order -> stop -> warehouse),
// scoped by companyId. No projection schema change.
//
// Label resolution (2026-05): rows JOIN dispatch_board_projection LEFT JOIN
// driver (operator_id) and LEFT JOIN vehicle (vehicle_id) so cells contain
// driver.full_name / vehicle.plate — never raw UUIDs. Missing reference rows
// fall back to em-dash (—), matching the DispatchBoard labels.ts invariant.
//
// Tenant scope: every join is gated by op.companyId. The export log row
// records (operator_id, company_id, trigger, day_key, row_count, sha256,
// filename) so the daily-backup invariant is auditable.
//
// Idempotency: for trigger='login'|'logout' a partial unique index on
// (company_id, operator_id, day_key, trigger) prevents duplicate ledger rows.
// The service detects the conflict via a pre-check SELECT and returns the
// existing row instead of inserting again. Manual exports bypass the check.
//
// Day key: VN timezone (UTC+7) calendar date as YYYY-MM-DD, computed in pure JS.
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { dispatchBoardProjection } from '../database/schema/projections.js';
import { customer, driver, vehicle } from '../database/schema/reference.js';
import { roadRunTransportOrder, stop, transportOrder } from '../database/schema/transport.js';
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
interface ExportStop {
  readonly sequence: number;
  readonly stopType: string;
  readonly arrivedAt: Date | null;
  readonly departedAt: Date | null;
}
interface ExportRow {
  readonly roadRunId: string;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
  readonly plannedStartAt: Date | null;
  readonly driverName: string | null;
  readonly vehiclePlate: string | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly stops: readonly ExportStop[];
}
// On-screen Lệnh điều xe columns, in order. Mirrors DispatchView.tsx +
// board-stops.tsx (PICKUP_SLOTS 1..4, DELIVERY_SLOTS 1).
const PICKUP_SLOTS = [1, 2, 3, 4] as const;
const DELIVERY_SLOTS = [1] as const;
const HEADERS = [
  'Số lệnh', 'Khách hàng', 'Tài xế', 'Xe', 'Ngày dự kiến', 'Số điểm',
  ...PICKUP_SLOTS.map((n) => 'Điểm nhận hàng ' + String(n)),
  ...DELIVERY_SLOTS.map((n) => 'Kho giao hàng ' + String(n)),
] as const;
const DASH = '—';
const PLANNED_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'medium',
  timeStyle: 'short',
});
// Mirrors board-stops.tsx stopStatusOf: completed-with-VN-date or 'Chưa tới'.
const STOP_STATUS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
function stopStatusOf(s: ExportStop): string {
  const done = s.departedAt ?? s.arrivedAt;
  if (done === null) return 'Chưa tới';
  if (Number.isNaN(done.getTime())) return 'Chưa tới';
  return 'Đã hoàn thành ' + STOP_STATUS_FORMATTER.format(done);
}
// Mirrors board-stops.tsx stopForSlot: nth stop of a type, 1-based slot index.
function stopForSlot(stops: readonly ExportStop[], stopType: 'pickup' | 'delivery', slotIndex: number): ExportStop | undefined {
  const ofType = stops
    .filter((s) => {
      const t = s.stopType.toLowerCase();
      return stopType === 'pickup' ? t === 'pickup' : t === 'delivery' || t === 'dropoff';
    })
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  return ofType[slotIndex - 1];
}
function slotStatus(stops: readonly ExportStop[], stopType: 'pickup' | 'delivery', slotIndex: number): string {
  const s = stopForSlot(stops, stopType, slotIndex);
  return s ? stopStatusOf(s) : DASH;
}
// Khách hàng cell: name with phone folded onto a second line when present.
// Mirrors the on-screen CustomerCell which stacks name over phone.
function customerCell(name: string | null, phone: string | null): string {
  const baseName = name === null || name === '' ? DASH : name;
  if (phone === null || phone === '') return baseName;
  return baseName + '\n' + phone;
}
function vnDayKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return String(y) + '-' + m + '-' + d;
}
function tenantSlug(companyId: string): string {
  return companyId.replace(/-/g, '').slice(0, 8);
}
@Injectable()
export class TransportOrdersExportService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async exportAndLog(op: OperatorContext, trigger: ExportTrigger): Promise<ExportResult> {
    const dayKey = vnDayKey();
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
    const rows = await this.fetchRows(op);
    const buffer = await this.buildXlsxBufferFromRows(rows);
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
  // Same scope + joins as DispatchController.getBoard: driver/vehicle labels via
  // company-scoped LEFT JOINs on the projection; customer name/phone and per-stop
  // detail enriched at read time from road_run_transport_order, grouped by road run.
  private async fetchRows(op: OperatorContext): Promise<readonly ExportRow[]> {
    const base = await this.db
      .select({
        roadRunId: dispatchBoardProjection.roadRunId,
        stopCount: dispatchBoardProjection.stopCount,
        transportOrderRefs: dispatchBoardProjection.transportOrderRefs,
        plannedStartAt: dispatchBoardProjection.plannedStartAt,
        driverName: driver.fullName,
        vehiclePlate: vehicle.plate,
      })
      .from(dispatchBoardProjection)
      .leftJoin(driver, and(
        eq(driver.operatorId, dispatchBoardProjection.assignedOperatorId),
        eq(driver.companyId, op.companyId),
      ))
      .leftJoin(vehicle, and(
        eq(vehicle.vehicleId, dispatchBoardProjection.assignedAssetId),
        eq(vehicle.companyId, op.companyId),
      ))
      .where(eq(dispatchBoardProjection.companyId, op.companyId))
      .orderBy(asc(dispatchBoardProjection.plannedStartAt));
    const roadRunIds = base.map((r) => r.roadRunId);
    const stopsByRoadRun = new Map<string, ExportStop[]>();
    const customerByRoadRun = new Map<string, string | null>();
    const customerPhoneByRoadRun = new Map<string, string | null>();
    if (roadRunIds.length > 0) {
      const stopRows = await this.db
        .select({
          roadRunId: roadRunTransportOrder.roadRunId,
          sequence: stop.sequence,
          stopType: stop.stopType,
          arrivedAt: stop.arrivedAt,
          departedAt: stop.departedAt,
        })
        .from(roadRunTransportOrder)
        .innerJoin(stop, eq(stop.transportOrderId, roadRunTransportOrder.transportOrderId))
        .where(and(
          eq(roadRunTransportOrder.companyId, op.companyId),
          inArray(roadRunTransportOrder.roadRunId, roadRunIds),
        ))
        .orderBy(asc(stop.sequence));
      for (const sr of stopRows) {
        const list = stopsByRoadRun.get(sr.roadRunId) ?? [];
        list.push({ sequence: sr.sequence, stopType: sr.stopType, arrivedAt: sr.arrivedAt, departedAt: sr.departedAt });
        stopsByRoadRun.set(sr.roadRunId, list);
      }
      const customerRows = await this.db
        .select({
          roadRunId: roadRunTransportOrder.roadRunId,
          customerName: customer.name,
          customerPhone: customer.phone,
        })
        .from(roadRunTransportOrder)
        .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
        .innerJoin(customer, eq(customer.customerId, transportOrder.customerId))
        .where(and(
          eq(roadRunTransportOrder.companyId, op.companyId),
          inArray(roadRunTransportOrder.roadRunId, roadRunIds),
        ))
        .orderBy(asc(roadRunTransportOrder.sequence));
      for (const cr of customerRows) {
        if (!customerByRoadRun.has(cr.roadRunId)) {
          customerByRoadRun.set(cr.roadRunId, cr.customerName);
          customerPhoneByRoadRun.set(cr.roadRunId, cr.customerPhone);
        }
      }
    }
    return base.map((r) => ({
      roadRunId: r.roadRunId,
      stopCount: r.stopCount,
      transportOrderRefs: r.transportOrderRefs,
      plannedStartAt: r.plannedStartAt,
      driverName: r.driverName,
      vehiclePlate: r.vehiclePlate,
      customerName: customerByRoadRun.get(r.roadRunId) ?? null,
      customerPhone: customerPhoneByRoadRun.get(r.roadRunId) ?? null,
      stops: stopsByRoadRun.get(r.roadRunId) ?? [],
    }));
  }
  private async buildXlsxBufferForOp(op: OperatorContext): Promise<Buffer> {
    const rows = await this.fetchRows(op);
    return this.buildXlsxBufferFromRows(rows);
  }
  private buildXlsxBufferFromRows(rows: readonly ExportRow[]): Promise<Buffer> {
    return this.buildWorkbook(rows);
  }
  private async buildWorkbook(rows: readonly ExportRow[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FleetManagement';
    wb.created = new Date(0);
    const ws = wb.addWorksheet('Lệnh điều xe');
    ws.addRow([...HEADERS]);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const primaryRef = r.transportOrderRefs[0] ?? DASH;
      const planned = r.plannedStartAt ? PLANNED_FORMATTER.format(r.plannedStartAt) : DASH;
      ws.addRow([
        primaryRef,
        customerCell(r.customerName, r.customerPhone),
        r.driverName ?? DASH,
        r.vehiclePlate ?? DASH,
        planned,
        r.stopCount,
        ...PICKUP_SLOTS.map((n) => slotStatus(r.stops, 'pickup', n)),
        ...DELIVERY_SLOTS.map((n) => slotStatus(r.stops, 'delivery', n)),
      ]);
    }
    ws.columns.forEach((c) => { c.width = 22; });
    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab as ArrayBuffer);
  }
}
