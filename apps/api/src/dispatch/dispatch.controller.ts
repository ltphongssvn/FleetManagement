// apps/api/src/dispatch/dispatch.controller.ts
// Read-only HTTP endpoint serving dispatch_board_projection rows for ops-web.
// Per-stop enrichment (warehouse name, arrival/departure, customer) is joined at
// read time, scoped by company_id (summary projection + read-time-join pattern).
//
// Response shape is the SINGLE SOURCE OF TRUTH @fleet/sync-protocol contract: the
// row/stop/proof types are inferred (z.infer) from DispatchBoardApiResponseSchema
// / DispatchStopViewSchema / StopProofSchema — there are NO hand-written response
// interfaces here. The API emits the richer DispatchStopView stop (which carries
// the internal stopId it needs to associate proofs); ops-web parses the leaner
// DispatchBoardRowSchema (stops without stopId) per Postel.
//
// Pagination (2026): getBoardPage adds offset/page-number pagination over the
// projection, filtered by status group (active = planned|dispatched|started;
// finished = completed|cancelled — the partition derives from the SSOT
// statesForStatusGroup), returning the SSOT paginated envelope
// (DispatchBoardPageApiResponseSchema: data + page/pageSize/total/totalPages/
// hasMore). The per-row enrichment (stops, customer, proof, weight-diff) is
// shared with getBoard via the private enrichRows() so the paginated and full
// boards can never diverge in how a row is shaped.
//
// Phiếu Cân (2026): each stop is additionally enriched with its proof photo when
// a COMMITTED manifest is tied to that stop (manifest.stop_id). proof carries the
// manifestId + a short-lived presigned S3 GET URL (minted by StopProofUrlSigner,
// injected) so ops-web renders a clickable "Phiếu Cân" link without exposing the
// private bucket. The S3 object key/bucket come from the manifest's upload_session.
//
// SOFT DELETE: the board read filters deleted_at IS NULL so road runs hidden by a
// tombstone (soft-deleted, since the app role holds no DELETE privilege) never appear.
import { Controller, Get, Inject, Optional, Query, UseGuards } from '@nestjs/common';
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { computeWeightDiffKg, statesForStatusGroup, RoadRunPageQuerySchema } from '@fleet/sync-protocol';
import type { DispatchBoardApiResponse, DispatchBoardApiRow, DispatchBoardPageApiResponse, DispatchStopView, StopProof, WeightDiffStop } from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  cargoType,
  customer,
  dispatchBoardProjection,
  driver,
  manifest,
  roadRunTransportOrder,
  stop,
  transportOrder,
  uploadSession,
  vehicle,
  warehouse,
} from '../database/schema/index.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { STOP_PROOF_URL_SIGNER, type StopProofUrlSigner } from './stop-proof-url.port.js';
/** Pilot dispatch board cap. PDF Day-One: 5 trucks/depot, ~tens of runs/day. */
const DISPATCH_BOARD_MAX_ROWS = 500;
/** Proof-photo link TTL: 15 minutes is enough to view from the board. */
const PROOF_URL_TTL_SECONDS = 900;
// Internal proof-association carrier: the committed-manifest fields resolved per
// stopId before the presigned URL is minted. NOT the wire shape (StopProof is) —
// this holds the S3 bucket/key needed to sign, which never leave the server.
interface ProofSource {
  readonly manifestId: string;
  readonly bucket: string;
  readonly key: string;
  readonly capturedAt: string;
  readonly extractedNetWeightKg: number | null;
  readonly extractionStatus: 'pending' | 'extracted' | 'not_found' | 'unreadable' | 'manual';
  readonly extractionReason: 'unparseable' | 'below_sanity_min' | 'above_sanity_max' | 'no_field' | 'object_missing' | null;
}
// The base projection row (after driver/vehicle label joins) that enrichRows
// turns into a full DispatchBoardApiRow. Identical select shape in getBoard and
// getBoardPage, so both feed the same enrichment.
interface BoardBaseRow {
  readonly roadRunId: string;
  readonly state: DispatchBoardApiRow['state'];
  readonly assignedOperatorId: string | null;
  readonly assignedAssetId: string | null;
  readonly plannedStartAt: Date | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
  readonly driverName: string | null;
  readonly vehiclePlate: string | null;
}

@Controller('dispatch')
@UseGuards(JwtGuard)
export class DispatchController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Optional() @Inject(STOP_PROOF_URL_SIGNER) private readonly proofSigner?: StopProofUrlSigner,
  ) {}
  // Diacritic-insensitive free-text search predicate over the dispatcher board
  // columns. Vietnamese domain: unaccent() both sides so a term typed without
  // marks (chau) matches an accented value (CHAU-with-marks). Correlated EXISTS
  // subqueries reach the joined/enriched columns (customer, warehouse) that are
  // not in the base projection, so the match filters BEFORE LIMIT without
  // changing row cardinality. Columns covered: So lenh (transport_order_refs
  // jsonb), Tai xe (driver.full_name), Xe (vehicle.plate), Ngay du kien
  // (planned_start_at text), So diem (stop_count text), Khach hang (customer
  // name/phone), Ten hang (cargo_type name), Diem/Kho (warehouse name). Chenh
  // lech is JS-computed, not a column, so it is not searchable. Returns undefined when no
  // term is given so the caller keeps the base predicate untouched (back-compat).
  private buildSearchClause(op: OperatorContext, search: string | undefined): ReturnType<typeof or> | undefined {
    if (search === undefined || search === '') return undefined;
    const like = '%' + search + '%';
    const co = op.companyId;
    const p = dispatchBoardProjection;
    return or(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${p.transportOrderRefs}) AS ref WHERE unaccent(ref) ILIKE unaccent(${like}))`,
      sql`EXISTS (SELECT 1 FROM driver d WHERE d.operator_id = ${p.assignedOperatorId} AND d.company_id = ${co} AND unaccent(d.full_name) ILIKE unaccent(${like}))`,
      sql`EXISTS (SELECT 1 FROM vehicle v WHERE v.vehicle_id = ${p.assignedAssetId} AND v.company_id = ${co} AND unaccent(v.plate) ILIKE unaccent(${like}))`,
      sql`CAST(${p.plannedStartAt} AS text) ILIKE ${like}`,
      sql`CAST(${p.stopCount} AS text) ILIKE ${like}`,
      sql`EXISTS (SELECT 1 FROM road_run_transport_order rto JOIN transport_order t ON t.transport_order_id = rto.transport_order_id JOIN customer c ON c.customer_id = t.customer_id WHERE rto.road_run_id = ${p.roadRunId} AND rto.company_id = ${co} AND (unaccent(c.name) ILIKE unaccent(${like}) OR c.phone ILIKE ${like}))`,
      sql`EXISTS (SELECT 1 FROM road_run_transport_order rto JOIN stop st ON st.transport_order_id = rto.transport_order_id JOIN warehouse w ON w.warehouse_id = st.yard_id WHERE rto.road_run_id = ${p.roadRunId} AND rto.company_id = ${co} AND unaccent(w.name) ILIKE unaccent(${like}))`,
      sql`EXISTS (SELECT 1 FROM road_run_transport_order rto JOIN transport_order t ON t.transport_order_id = rto.transport_order_id JOIN cargo_type ct ON ct.cargo_type_id = t.cargo_type_id WHERE rto.road_run_id = ${p.roadRunId} AND rto.company_id = ${co} AND unaccent(ct.name) ILIKE unaccent(${like}))`,
    );
  }

  @Get('board')
  async getBoard(
    @CurrentOperator() op: OperatorContext,
  ): Promise<DispatchBoardApiResponse> {
    const rows = await this.db
      .select({
        roadRunId: dispatchBoardProjection.roadRunId,
        state: dispatchBoardProjection.state,
        assignedOperatorId: dispatchBoardProjection.assignedOperatorId,
        assignedAssetId: dispatchBoardProjection.assignedAssetId,
        plannedStartAt: dispatchBoardProjection.plannedStartAt,
        stopCount: dispatchBoardProjection.stopCount,
        transportOrderRefs: dispatchBoardProjection.transportOrderRefs,
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
        isNull(dispatchBoardProjection.deletedAt),
      ))
      .orderBy(dispatchBoardProjection.plannedStartAt)
      .limit(DISPATCH_BOARD_MAX_ROWS);
    return { rows: await this.enrichRows(op, rows) };
  }
  // Paginated + status-partitioned board. Offset/page-number pagination (the
  // dispatcher UI needs page-number jump, which only offset supports); group
  // filters by the SSOT active/finished partition; total drives totalPages +
  // hasMore (never paginate without a total).
  // GET /dispatch/board/page?group=&page=&pageSize=&search= — paginated board.
  // Tenancy comes from the JWT (CurrentOperator), never the query string (no
  // IDOR), mirroring getBoard + the export controller. Raw query is parsed by
  // the SSOT RoadRunPageQuerySchema (coerces strings, defaults, .strict()).
  @Get('board/page')
  async getBoardPage(
    @CurrentOperator() op: OperatorContext,
    @Query() query: Record<string, unknown>,
  ): Promise<DispatchBoardPageApiResponse> {
    const { group, page, pageSize, search } = RoadRunPageQuerySchema.parse(query);
    const states = statesForStatusGroup(group);
    // Base tenant + soft-delete + status-group predicate. The optional free-text
    // search predicate is AND-combined so BOTH the COUNT and the LIMIT/OFFSET page
    // read see the identical WHERE -> total/totalPages stay consistent with the slice.
    const baseWhere = and(
      eq(dispatchBoardProjection.companyId, op.companyId),
      isNull(dispatchBoardProjection.deletedAt),
      inArray(dispatchBoardProjection.state, [...states]),
    );
    const searchClause = this.buildSearchClause(op, search);
    const whereClause = searchClause === undefined ? baseWhere : and(baseWhere, searchClause);
    const totalRows = await this.db
      .select({ value: count() })
      .from(dispatchBoardProjection)
      .where(whereClause);
    const total = totalRows[0]?.value ?? 0;
    const rows = await this.db
      .select({
        roadRunId: dispatchBoardProjection.roadRunId,
        state: dispatchBoardProjection.state,
        assignedOperatorId: dispatchBoardProjection.assignedOperatorId,
        assignedAssetId: dispatchBoardProjection.assignedAssetId,
        plannedStartAt: dispatchBoardProjection.plannedStartAt,
        stopCount: dispatchBoardProjection.stopCount,
        transportOrderRefs: dispatchBoardProjection.transportOrderRefs,
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
      .where(whereClause)
      .orderBy(dispatchBoardProjection.plannedStartAt)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const data = await this.enrichRows(op, rows);
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    return { data, page, pageSize, total, totalPages, hasMore: page < totalPages };
  }
  // Shared per-row enrichment: given base projection rows (driver/vehicle labels
  // already joined), resolve stops (+ proof photos), customer name/phone, and the
  // pickup-vs-delivery weight diff, producing the canonical DispatchBoardApiRow[].
  private async enrichRows(op: OperatorContext, rows: readonly BoardBaseRow[]): Promise<DispatchBoardApiRow[]> {
    const roadRunIds = rows.map((r) => r.roadRunId);
    const stopsByRoadRun = new Map<string, DispatchStopView[]>();
    const customerByRoadRun = new Map<string, string>();
    const customerPhoneByRoadRun = new Map<string, string | null>();
    const cargoByRoadRun = new Map<string, string | null>();
    if (roadRunIds.length > 0) {
      const stopRows = await this.db
        .select({
          roadRunId: roadRunTransportOrder.roadRunId,
          stopId: stop.stopId,
          sequence: stop.sequence,
          stopType: stop.stopType,
          warehouseName: warehouse.name,
          arrivedAt: stop.arrivedAt,
          departedAt: stop.departedAt,
        })
        .from(roadRunTransportOrder)
        .innerJoin(stop, eq(stop.transportOrderId, roadRunTransportOrder.transportOrderId))
        .leftJoin(warehouse, eq(warehouse.warehouseId, stop.yardId))
        .where(and(
          eq(roadRunTransportOrder.companyId, op.companyId),
          inArray(roadRunTransportOrder.roadRunId, roadRunIds),
        ))
        .orderBy(stop.sequence);
      const stopIds = stopRows.map((sr) => sr.stopId);
      const proofByStopId = new Map<string, ProofSource>();
      if (stopIds.length > 0) {
        const proofRows = await this.db
          .select({
            stopId: manifest.stopId,
            manifestId: manifest.manifestId,
            committedAt: manifest.committedAt,
            extractedNetWeightKg: manifest.extractedNetWeightKg,
            extractionStatus: manifest.extractionStatus,
            extractionReason: manifest.extractionReason,
            s3Key: uploadSession.s3Key,
            s3Bucket: uploadSession.s3Bucket,
          })
          .from(manifest)
          .innerJoin(uploadSession, eq(uploadSession.manifestId, manifest.manifestId))
          .where(and(
            eq(manifest.companyId, op.companyId),
            eq(manifest.state, 'committed'),
            inArray(manifest.stopId, stopIds),
          ));
        for (const pr of proofRows) {
          if (pr.stopId === null) continue;
          if (!proofByStopId.has(pr.stopId)) {
            proofByStopId.set(pr.stopId, {
              manifestId: pr.manifestId,
              bucket: pr.s3Bucket,
              key: pr.s3Key,
              capturedAt: (pr.committedAt ?? new Date()).toISOString(),
              extractedNetWeightKg: pr.extractedNetWeightKg === null ? null : Number(pr.extractedNetWeightKg),
              extractionStatus: pr.extractionStatus,
              extractionReason: pr.extractionReason,
            });
          }
        }
      }
      for (const sr of stopRows) {
        const list = stopsByRoadRun.get(sr.roadRunId) ?? [];
        const p = proofByStopId.get(sr.stopId);
        let proof: StopProof | null = null;
        if (p && this.proofSigner) {
          const photoUrl = await this.proofSigner.presignProofUrl({ bucket: p.bucket, key: p.key, ttlSeconds: PROOF_URL_TTL_SECONDS });
          proof = { manifestId: p.manifestId, photoUrl, capturedAt: p.capturedAt, extractedNetWeightKg: p.extractedNetWeightKg, extractionStatus: p.extractionStatus, extractionReason: p.extractionReason };
        }
        list.push({
          stopId: sr.stopId,
          sequence: sr.sequence,
          stopType: sr.stopType as DispatchStopView['stopType'],
          warehouseName: sr.warehouseName,
          arrivedAt: sr.arrivedAt ? sr.arrivedAt.toISOString() : null,
          departedAt: sr.departedAt ? sr.departedAt.toISOString() : null,
          proof,
        });
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
        .orderBy(roadRunTransportOrder.sequence);
      for (const cr of customerRows) {
        if (!customerByRoadRun.has(cr.roadRunId)) {
          customerByRoadRun.set(cr.roadRunId, cr.customerName);
          customerPhoneByRoadRun.set(cr.roadRunId, cr.customerPhone);
        }
      }
      const cargoRows = await this.db
        .select({
          roadRunId: roadRunTransportOrder.roadRunId,
          cargoName: cargoType.name,
        })
        .from(roadRunTransportOrder)
        .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
        .leftJoin(cargoType, eq(cargoType.cargoTypeId, transportOrder.cargoTypeId))
        .where(and(
          eq(roadRunTransportOrder.companyId, op.companyId),
          inArray(roadRunTransportOrder.roadRunId, roadRunIds),
        ))
        .orderBy(roadRunTransportOrder.sequence);
      for (const gr of cargoRows) {
        if (!cargoByRoadRun.has(gr.roadRunId)) {
          cargoByRoadRun.set(gr.roadRunId, gr.cargoName);
        }
      }
    }
    const result: DispatchBoardApiRow[] = rows.map((r) => ({
      roadRunId: r.roadRunId,
      state: r.state,
      assignedOperatorId: r.assignedOperatorId,
      assignedAssetId: r.assignedAssetId,
      driverName: r.driverName,
      vehiclePlate: r.vehiclePlate,
      plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
      stopCount: r.stopCount,
      transportOrderRefs: r.transportOrderRefs,
      customerName: customerByRoadRun.get(r.roadRunId) ?? null,
      customerPhone: customerPhoneByRoadRun.get(r.roadRunId) ?? null,
      cargoName: cargoByRoadRun.get(r.roadRunId) ?? null,
      weightDiffKg: computeWeightDiffKg(
        (stopsByRoadRun.get(r.roadRunId) ?? []).map((s): WeightDiffStop => ({
          stopType: s.stopType,
          extractedNetWeightKg: s.proof?.extractedNetWeightKg ?? null,
        })),
      ),
      stops: stopsByRoadRun.get(r.roadRunId) ?? [],
    }));
    return result;
  }
}
