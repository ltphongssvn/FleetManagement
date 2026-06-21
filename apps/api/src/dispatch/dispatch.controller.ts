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
// Phiếu Cân (2026): each stop is additionally enriched with its proof photo when
// a COMMITTED manifest is tied to that stop (manifest.stop_id). proof carries the
// manifestId + a short-lived presigned S3 GET URL (minted by StopProofUrlSigner,
// injected) so ops-web renders a clickable "Phiếu Cân" link without exposing the
// private bucket. The S3 object key/bucket come from the manifest's upload_session.
// EXPAND-only: arrivedAt/departedAt are unchanged; proof is added (null when no
// committed manifest), so existing ops-web code stays valid.
import { Controller, Get, Inject, Optional, UseGuards } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { DispatchBoardApiResponse, DispatchBoardApiRow, DispatchStopView, StopProof } from '@fleet/sync-protocol';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
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
@Controller('dispatch')
@UseGuards(JwtGuard)
export class DispatchController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Optional() @Inject(STOP_PROOF_URL_SIGNER) private readonly proofSigner?: StopProofUrlSigner,
  ) {}
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
      .where(eq(dispatchBoardProjection.companyId, op.companyId))
      .orderBy(dispatchBoardProjection.plannedStartAt)
      .limit(DISPATCH_BOARD_MAX_ROWS);
    const roadRunIds = rows.map((r) => r.roadRunId);
    const stopsByRoadRun = new Map<string, DispatchStopView[]>();
    const customerByRoadRun = new Map<string, string>();
    const customerPhoneByRoadRun = new Map<string, string | null>();
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
      // Proof photos: committed manifests tied to these stops, joined to their
      // upload_session for the S3 object key. Map stopId -> ProofSource for the
      // most recent committed manifest per stop.
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
              // numeric(12,3) arrives as a string from pg; contract wants number.
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
      stops: stopsByRoadRun.get(r.roadRunId) ?? [],
    }));
    return { rows: result };
  }
}
