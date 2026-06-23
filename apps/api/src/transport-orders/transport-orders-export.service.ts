// apps/api/src/transport-orders/transport-orders-export.service.ts
//
// T1 (2026): exports the Lệnh điều xe (dispatch board) rows as an .xlsx
// Buffer using ExcelJS and records the export in transport_order_export_log.
//
// DATA EXPORT (2026, Feature 2): the workbook is a DATA export for spreadsheet
// analysis, NOT a screenshot of the board. After the 6 identifying columns
// (Số lệnh | Khách hàng | Tài xế | Xe | Ngày dự kiến | Số điểm) each stop slot
// contributes a PAIR of columns: the warehouse NAME and the extracted net weight
// as a NUMBER (kg). There is NO per-stop status text and NO em-dash filler: a
// slot with no stop, or a stop whose Phiếu Cân weight has not been extracted yet,
// leaves the weight cell EMPTY (a true blank, never 0) so spreadsheet SUM/AVERAGE
// over a kg column stay correct — a 0 would assert a real zero weight and skew
// AVERAGE/COUNT (2026 missing-data export best practice). The warehouse name and
// per-stop weight are joined at read time using the SAME company-scoped joins
// DispatchController.getBoard uses (road_run_transport_order -> stop -> warehouse;
// committed manifest -> upload_session for the extracted weight). No projection
// schema change.
//
// The Khách hàng cell carries the customer name and, when present, the phone on a
// second line (the on-screen cell stacks name over phone; Excel is flat so the
// phone is folded into that one cell — it is NOT a separate column).
//
// Label resolution (2026-05): rows JOIN dispatch_board_projection LEFT JOIN
// driver (operator_id) and LEFT JOIN vehicle (vehicle_id) so cells contain
// driver.full_name / vehicle.plate — never raw UUIDs. Missing reference rows
// fall back to em-dash (—) in those identifying columns, matching labels.ts.
//
// Tenant scope: every join is gated by op.companyId. The export log row records
// (operator_id, company_id, trigger, day_key, row_count, sha256, filename) so the
// daily-backup invariant is auditable.
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
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { dispatchBoardProjection } from '../database/schema/projections.js';
import { customer, driver, vehicle } from '../database/schema/reference.js';
import { roadRunTransportOrder, stop, transportOrder } from '../database/schema/transport.js';
import { manifest, uploadSession } from '../database/schema/manifest.js';
import { warehouse } from '../database/schema/reference.js';
import { netWeightKgSchema, computeWeightDiffKg, type ExportDateRange, type WeightDiffStop } from '@fleet/sync-protocol';
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
  readonly stopId: string;
  readonly sequence: number;
  readonly stopType: string;
  readonly warehouseName: string | null;
  readonly extractedNetWeightKg: number | null;
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
// On-screen Lệnh điều xe slots, in order. Mirrors board-stops.tsx
// (PICKUP_SLOTS 1..4, DELIVERY_SLOTS 1).
const PICKUP_SLOTS = [1, 2, 3, 4] as const;
const DELIVERY_SLOTS = [1] as const;
const KG_SUFFIX = ' - KL (kg)';
// 6 identifying columns, then a (name, kg) PAIR per slot.
const HEADERS = [
  'Số lệnh', 'Khách hàng', 'Tài xế', 'Xe', 'Ngày dự kiến', 'Số điểm', 'Chênh lệch',
  ...PICKUP_SLOTS.flatMap((n) => ['Điểm nhận hàng ' + String(n), 'Điểm nhận hàng ' + String(n) + KG_SUFFIX]),
  ...DELIVERY_SLOTS.flatMap((n) => ['Kho giao hàng ' + String(n), 'Kho giao hàng ' + String(n) + KG_SUFFIX]),
] as const;
const DASH = '—';
const PLANNED_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'medium',
  timeStyle: 'short',
});
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
// Warehouse-name cell for a slot: the stop's warehouse name, or null (true blank)
// when the slot has no stop / no name. Never em-dash filler in a data export.
function slotNameCell(stops: readonly ExportStop[], stopType: 'pickup' | 'delivery', slotIndex: number): string | null {
  const s = stopForSlot(stops, stopType, slotIndex);
  if (s === undefined) return null;
  return s.warehouseName === null || s.warehouseName === '' ? null : s.warehouseName;
}
// Weight cell for a slot: the extracted Phiếu Cân net weight as a NUMBER, or null
// (true blank) when the slot has no stop or no extracted weight yet. NEVER 0 and
// NEVER a status string, so SUM/AVERAGE over the kg column stay correct.
function slotWeightCell(stops: readonly ExportStop[], stopType: 'pickup' | 'delivery', slotIndex: number): number | null {
  const s = stopForSlot(stops, stopType, slotIndex);
  if (s === undefined) return null;
  return s.extractedNetWeightKg;
}
// Khách hàng cell: name with phone folded onto a second line when present.
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
  async exportAndLog(op: OperatorContext, trigger: ExportTrigger, range?: ExportDateRange): Promise<ExportResult> {
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
    const rows = await this.fetchRows(op, range);
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
  // company-scoped LEFT JOINs on the projection; customer name/phone, per-stop
  // warehouse name + extracted weight enriched at read time, grouped by road run.
  private async fetchRows(op: OperatorContext, range?: ExportDateRange): Promise<readonly ExportRow[]> {
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
      .where(and(
        eq(dispatchBoardProjection.companyId, op.companyId),
        // Feature 4: inclusive VN-local calendar-date window. Convert the stored
        // UTC instant to Asia/Ho_Chi_Minh wall-clock, take its date, and bound it
        // by [from, to]. A null planned_start_at yields NULL here and is excluded
        // when a range is applied (an order with no planned date cannot fall in a
        // date window).
        range === undefined
          ? undefined
          : sql`(${dispatchBoardProjection.plannedStartAt} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= ${range.from}::date`,
        range === undefined
          ? undefined
          : sql`(${dispatchBoardProjection.plannedStartAt} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= ${range.to}::date`,
      ))
      .orderBy(asc(dispatchBoardProjection.plannedStartAt));
    const roadRunIds = base.map((r) => r.roadRunId);
    const stopsByRoadRun = new Map<string, ExportStop[]>();
    const customerByRoadRun = new Map<string, string | null>();
    const customerPhoneByRoadRun = new Map<string, string | null>();
    if (roadRunIds.length > 0) {
      const stopRows = await this.db
        .select({
          roadRunId: roadRunTransportOrder.roadRunId,
          stopId: stop.stopId,
          sequence: stop.sequence,
          stopType: stop.stopType,
          warehouseName: warehouse.name,
        })
        .from(roadRunTransportOrder)
        .innerJoin(stop, eq(stop.transportOrderId, roadRunTransportOrder.transportOrderId))
        .leftJoin(warehouse, eq(warehouse.warehouseId, stop.yardId))
        .where(and(
          eq(roadRunTransportOrder.companyId, op.companyId),
          inArray(roadRunTransportOrder.roadRunId, roadRunIds),
        ))
        .orderBy(asc(stop.sequence));
      // Phiếu Cân net weight per stop: committed manifests joined to upload_session;
      // coerce the pg numeric(12,3) string and VALIDATE via the netWeightKgSchema SSOT.
      const allStopIds = stopRows.map((sr) => sr.stopId);
      const weightByStopId = new Map<string, number | null>();
      if (allStopIds.length > 0) {
        const proofRows = await this.db
          .select({ stopId: manifest.stopId, extractedNetWeightKg: manifest.extractedNetWeightKg })
          .from(manifest)
          .innerJoin(uploadSession, eq(uploadSession.manifestId, manifest.manifestId))
          .where(and(eq(manifest.companyId, op.companyId), eq(manifest.state, 'committed'), inArray(manifest.stopId, allStopIds)));
        for (const pr of proofRows) {
          if (pr.stopId === null) continue;
          if (weightByStopId.has(pr.stopId)) continue;
          let kg: number | null = null;
          if (pr.extractedNetWeightKg !== null) {
            const parsed = netWeightKgSchema.safeParse(Number(pr.extractedNetWeightKg));
            if (parsed.success) kg = parsed.data;
          }
          weightByStopId.set(pr.stopId, kg);
        }
      }
      for (const sr of stopRows) {
        const list = stopsByRoadRun.get(sr.roadRunId) ?? [];
        list.push({ stopId: sr.stopId, sequence: sr.sequence, stopType: sr.stopType, warehouseName: sr.warehouseName, extractedNetWeightKg: weightByStopId.get(sr.stopId) ?? null });
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
        // Feature 3: pickup-vs-delivery net-weight difference via the shared
        // @fleet/sync-protocol SSOT, so this column matches the dispatch board
        // exactly. null (true blank) when any contributing weight is unknown —
        // never 0 — consistent with the kg columns missing-data rule.
        computeWeightDiffKg(r.stops.map((st): WeightDiffStop => ({ stopType: st.stopType as WeightDiffStop['stopType'], extractedNetWeightKg: st.extractedNetWeightKg }))),
        ...PICKUP_SLOTS.flatMap((n) => [slotNameCell(r.stops, 'pickup', n), slotWeightCell(r.stops, 'pickup', n)]),
        ...DELIVERY_SLOTS.flatMap((n) => [slotNameCell(r.stops, 'delivery', n), slotWeightCell(r.stops, 'delivery', n)]),
      ]);
    }
    ws.columns.forEach((c) => { c.width = 22; });
    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab as ArrayBuffer);
  }
}
