import { OUTBOX_QUEUES, MANIFEST_MAX_SIZE_BYTES, type ManifestStopRef } from '@fleet/sync-protocol';
// apps/api/src/manifest/manifest.service.ts
// Manifest service per Frozen Stack PDF "Manifest" + "Uploads".
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CLOCK, SystemClock, type Clock } from '../common/clock.js';
import { ID_GENERATOR, SystemIdGenerator, type IdGenerator } from '../common/id-generator.js';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import mime from 'mime-types';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
type Tx = Parameters<Parameters<FleetDb['transaction']>[0]>[0];
import { manifest, uploadSession } from '../database/schema/manifest.js';
import { outbox } from '../database/schema/append-paths.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import { completeRunIfDelivered } from '../maintenance/repair-complete-delivered-runs.js';
import { stop, transportOrder } from '../database/schema/transport.js';
import { BLOB_STORE, type IBlobStore } from '../storage/storage-provider.interface.js';
import type { Env } from '../config/env.config.js';
import type { NegotiateUploadInput, NegotiateUploadResponse, CommitUploadInput, CommitUploadResponse } from './manifest.dto.js';
import { ManifestInsertFailedError, TransportOrderNotOwnedError, UploadSessionInsertFailedError, UploadSessionMissingManifestError, UploadSessionNotFoundError, UploadSessionInvalidStateError, ManifestStateInvalidTransitionError, StopNotOnTransportOrderError, DeliveryCaptureGateError } from './manifest.errors.js';

import {
  UPLOAD_SESSION_COMMITTABLE_STATES,
  UPLOAD_SESSION_FINALIZABLE_STATES,
  MANIFEST_VERIFIABLE_STATES,
  MANIFEST_FINALIZABLE_STATES,
  MANIFEST_PHOTO_RECEIVED_STATES,
  evaluateDeliveryGate,
  classifyStopRole,
  type ManifestRejectionReason,
} from '@fleet/domain';
import type { OperatorContext } from '../auth/operator-context.js';
export type { OperatorContext };

@Injectable()
export class ManifestService {
  private readonly presignTtlSeconds: number;

  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(BLOB_STORE) private readonly blobs: IBlobStore,
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional() @Inject(ID_GENERATOR) ids?: IdGenerator,
  ) {
    this.presignTtlSeconds = config.getOrThrow('S3_PRESIGN_TTL_SECONDS', { infer: true });
    this.clock = clock ?? new SystemClock();
    this.ids = ids ?? new SystemIdGenerator();
  }

  async negotiateUpload(input: NegotiateUploadInput, op: OperatorContext): Promise<NegotiateUploadResponse> {
    return this.db.transaction(async (tx) => {
      await this.assertTransportOrderOwnership(tx, input.transportOrderId, op);
      const stopId = await this.resolveStopRef(tx, input.transportOrderId, input.stop ?? null, op);
      // AUTHORITATIVE delivery-capture phase-gate: block a delivery-stop upload
      // until every pickup has a committed proof photo. Same @fleet/domain rule
      // the driver-app card enforces for UX; here it is the real enforcement
      // (the client Alert is bypassable). Runs before any manifest/session row
      // or presigned URL is created.
      if (stopId !== null) await this.assertDeliveryGate(tx, input.transportOrderId, stopId, op);
      const manifestRow = await this.findOrCreateManifest(tx, input, stopId, op);
      const key = this.buildS3Key(op, manifestRow.manifestId, input.manifestCorrelationId, input.contentType);
      const presigned = await this.blobs.presignUpload({ key, contentType: input.contentType, ttlSeconds: this.presignTtlSeconds });

      const [session] = await tx
        .insert(uploadSession)
        .values({
          manifestId: manifestRow.manifestId,
          operatorId: op.operatorId,
          s3Key: key,
          s3Bucket: presigned.bucket,
          contentType: input.contentType,
          expectedSizeBytes: input.expectedSizeBytes,
          companyId: op.companyId,
          businessUnitId: op.businessUnitId,
          depotId: op.depotId,
          legalEntityId: op.legalEntityId,
        })
        .returning();
      if (!session) throw new UploadSessionInsertFailedError(manifestRow.manifestId);

      return {
        uploadSessionId: session.uploadSessionId,
        url: presigned.url,
        key: presigned.key,
        bucket: presigned.bucket,
        expiresAt: presigned.expiresAt.toISOString(),
      };
    });
  }

  // Authoritative server enforcement of the delivery-capture phase-gate. Loads
  // every stop on the order plus its committed-proof state (a manifest in a
  // photo-received state joined by stopId -- the same threshold the cancel-lock
  // and the read-side hasManifest trust), then applies the shared
  // evaluateDeliveryGate rule. Throws DeliveryCaptureGateError (-> 409) when the
  // target is a delivery stop and any pickup still lacks a committed photo.
  // Pickups are order-independent; a pickup target is always allowed. Runs
  // inside the negotiate tx, before any row/URL is created.
  private async assertDeliveryGate(
    tx: Tx,
    transportOrderId: string,
    targetStopId: string,
    op: OperatorContext,
  ): Promise<void> {
    const stopRows = await tx
      .select({ stopId: stop.stopId, sequence: stop.sequence, stopType: stop.stopType })
      .from(stop)
      .where(and(
        eq(stop.transportOrderId, transportOrderId),
        eq(stop.companyId, op.companyId),
      ));
    const target = stopRows.find((srow) => srow.stopId === targetStopId);
    // Only a delivery target is gated; unknown/pickup targets pass through
    // (the rule itself fail-safes an unknown stopType to pickup).
    if (target === undefined || classifyStopRole(target.stopType) !== 'delivery') return;
    const proofRows = await tx
      .select({ stopId: manifest.stopId })
      .from(manifest)
      .where(and(
        eq(manifest.transportOrderId, transportOrderId),
        eq(manifest.companyId, op.companyId),
        inArray(manifest.state, [...MANIFEST_PHOTO_RECEIVED_STATES]),
      ));
    const proofStopIds = new Set(proofRows.map((r) => r.stopId).filter((id): id is string => id !== null));
    const gate = evaluateDeliveryGate(
      stopRows.map((srow) => ({
        sequence: srow.sequence,
        stopType: srow.stopType,
        warehouseName: 'Kho nhận hàng ' + String(srow.sequence),
        hasManifest: proofStopIds.has(srow.stopId),
      })),
      target.sequence,
    );
    if (!gate.allowed) {
      throw new DeliveryCaptureGateError(transportOrderId, gate.remainingPickupNames);
    }
  }

  private async findOrCreateManifest(tx: Tx, input: NegotiateUploadInput, stopId: string | null, op: OperatorContext): Promise<{ manifestId: string }> {
    const [created] = await tx
      .insert(manifest)
      .values({
        transportOrderId: input.transportOrderId,
        manifestCorrelationId: input.manifestCorrelationId,
        capturedByOperatorId: op.operatorId,
        stopId,
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      })
      .onConflictDoNothing({ target: manifest.manifestCorrelationId })
      .returning();
    if (created) return created;

    const [winner] = await tx
      .select()
      .from(manifest)
      .where(and(
        eq(manifest.manifestCorrelationId, input.manifestCorrelationId),
        eq(manifest.companyId, op.companyId),
      ))
      .limit(1);
    if (!winner) throw new ManifestInsertFailedError(input.manifestCorrelationId);
    return winner;
  }

  // Resolve the capture-time stop ref (ManifestStopRef, @fleet/sync-protocol)
  // to the stop PK, scoped to BOTH the transport order and the tenant so a
  // stopId from another order/company can never be attached (cross-order guard).
  // The schema refine guarantees at least one of stopId/stopSequence non-null;
  // explicit narrowing keeps tsc strict without type assertions.
  private async resolveStopRef(
    tx: Tx,
    transportOrderId: string,
    ref: ManifestStopRef | null,
    op: OperatorContext,
  ): Promise<string | null> {
    if (ref === null) return null;
    if (ref.stopId !== null) {
      const [row] = await tx
        .select({ stopId: stop.stopId })
        .from(stop)
        .where(and(
          eq(stop.stopId, ref.stopId),
          eq(stop.transportOrderId, transportOrderId),
          eq(stop.companyId, op.companyId),
        ))
        .limit(1);
      if (!row) throw new StopNotOnTransportOrderError(transportOrderId, ref);
      return row.stopId;
    }
    if (ref.stopSequence !== null) {
      const [row] = await tx
        .select({ stopId: stop.stopId })
        .from(stop)
        .where(and(
          eq(stop.sequence, ref.stopSequence),
          eq(stop.transportOrderId, transportOrderId),
          eq(stop.companyId, op.companyId),
        ))
        .limit(1);
      if (!row) throw new StopNotOnTransportOrderError(transportOrderId, ref);
      return row.stopId;
    }
    return null;
  }

  private async assertTransportOrderOwnership(
    tx: Tx,
    transportOrderId: string,
    op: OperatorContext,
  ): Promise<void> {
    const [row] = await tx
      .select({ id: transportOrder.transportOrderId })
      .from(transportOrder)
      .where(and(
        eq(transportOrder.transportOrderId, transportOrderId),
        eq(transportOrder.companyId, op.companyId),
      ))
      .limit(1);
    if (!row) throw new TransportOrderNotOwnedError(transportOrderId, op.companyId);
  }
  /**
   * Mark a previously negotiated upload as ready for verification.
   * Transitions upload_session: initiated/uploading -> verifying (atomic).
   * Final 'committed' transition is performed by the intake worker after S3 HEAD,
   * size/hash verification, and virus scan succeed.
   * Returns 409 (UploadAlreadyCommittedError) if session already past initial state.
   */
  async commitUpload(input: CommitUploadInput, op: OperatorContext): Promise<CommitUploadResponse> {
    return this.db.transaction(async (tx) => {
      // Atomic: only transition if currently 'initiated' or 'uploading'.
      // This collapses the SELECT-then-UPDATE race window.
      const updated = await tx
        .update(uploadSession)
        .set({
          state: 'verifying',
          actualSizeBytes: input.actualSizeBytes,
          contentHash: input.contentHash ?? null,
        })
        .where(and(
          eq(uploadSession.uploadSessionId, input.uploadSessionId),
          eq(uploadSession.companyId, op.companyId),
          inArray(uploadSession.state, [...UPLOAD_SESSION_COMMITTABLE_STATES]),
        ))
        .returning();

      const updatedSession = updated[0];
      if (!updatedSession) {
        // Either not found, wrong tenant, or already past initial state.
        // Disambiguate to give the client a useful error.
        const [existing] = await tx
          .select({ state: uploadSession.state })
          .from(uploadSession)
          .where(and(
            eq(uploadSession.uploadSessionId, input.uploadSessionId),
            eq(uploadSession.companyId, op.companyId),
          ))
          .limit(1);
        if (!existing) throw new UploadSessionNotFoundError(input.uploadSessionId);
        throw new UploadSessionInvalidStateError(
          input.uploadSessionId,
          existing.state,
          [...UPLOAD_SESSION_COMMITTABLE_STATES],
        );
      }
      if (!updatedSession.manifestId) throw new UploadSessionMissingManifestError(input.uploadSessionId);

      // Manifest enters 'verifying' state — intake worker will move it to 'captured'
      // (or 'rejected') after running the validateIntake policy.
      // Guard against backsliding from terminal states (committed/rejected).
      await tx
        .update(manifest)
        .set({ state: 'verifying' })
        .where(and(
          eq(manifest.manifestId, updatedSession.manifestId),
          inArray(manifest.state, [...MANIFEST_VERIFIABLE_STATES]),
        ));
      // Enqueue the intake job in the SAME tx as the verifying transition so the
      // worker validates the uploaded object and finalizes it to committed/rejected.
      // Without this, manifests stay in verifying forever and the road_run
      // completion gate (counts only committed) blocks every driver. Routed to the
      // intake queue via outbox-routing (manifest_intake.requested -> intake).
      await this.emitManifestIntakeRequestedEvent(tx, updatedSession, op);

      return {
        uploadSessionId: updatedSession.uploadSessionId,
        manifestId: updatedSession.manifestId,
        state: 'verifying',
      };
    });
  }


  /**
   * Worker callback after intake validation. Transitions manifest+upload_session
   * to committed/rejected and emits manifest.committed event to outbox so the
   * ERP queue picks it up. PDF Day-One #5 + #8.
   */
  async finalizeIntake(input: {
    readonly uploadSessionId: string;
    readonly accepted: boolean;
    readonly rejectionReasonCode?: ManifestRejectionReason;
  }, op: OperatorContext): Promise<{ manifestId: string; state: 'committed' | 'rejected' }> {
    return this.db.transaction(async (tx) => {
      const session = await this.transitionUploadSession(tx, input, op);
      await this.transitionManifest(tx, session.manifestId, input);
      if (input.accepted) {
        await this.emitManifestCommittedEvent(tx, session.manifestId, input.uploadSessionId, op);
        await this.emitManifestExtractionRequestedEvent(tx, session, op);
        // Edge-triggered completion (terminal-29 arc): a committed manifest may
        // be the LAST photo a run was waiting on. Re-evaluate the run now, in
        // this same tx, so completion fires the instant delivery is complete --
        // even when the photo commits long after the client complete-intent
        // window (the async-intake-lag strand). Reuses the completion predicate
        // SSOT (runIsDelivered); the batch reconciler stays the periodic backstop.
        const committedManifest = await tx
          .select({ transportOrderId: manifest.transportOrderId })
          .from(manifest)
          .where(eq(manifest.manifestId, session.manifestId))
          .limit(1);
        const orderId = committedManifest[0]?.transportOrderId;
        if (orderId !== undefined) {
          await completeRunIfDelivered(tx as never, op, orderId);
        }
      } else {
        await this.emitManifestRejectedEvent(tx, session.manifestId, input.uploadSessionId, input.rejectionReasonCode, op);
      }
      return { manifestId: session.manifestId, state: input.accepted ? 'committed' : 'rejected' };
    });
  }

  private async transitionUploadSession(
    tx: Tx,
    input: { readonly uploadSessionId: string; readonly accepted: boolean },
    op: OperatorContext,
  ): Promise<typeof uploadSession.$inferSelect & { manifestId: string }> {
    const targetUploadState = input.accepted ? 'committed' : 'rejected';
    const updated = await tx
      .update(uploadSession)
      .set({
        state: targetUploadState,
        ...(input.accepted ? { committedAt: this.clock.now() } : { abortedAt: this.clock.now() }),
      })
      .where(and(
        eq(uploadSession.uploadSessionId, input.uploadSessionId),
        eq(uploadSession.companyId, op.companyId),
        inArray(uploadSession.state, [...UPLOAD_SESSION_FINALIZABLE_STATES]),
      ))
      .returning();
    const session = updated[0];
    if (!session) throw new UploadSessionNotFoundError(input.uploadSessionId);
    if (!session.manifestId) throw new UploadSessionMissingManifestError(input.uploadSessionId);
    return { ...session, manifestId: session.manifestId };
  }

  private async transitionManifest(
    tx: Tx,
    manifestId: string,
    input: { readonly accepted: boolean; readonly rejectionReasonCode?: ManifestRejectionReason },
  ): Promise<void> {
    const updated = await tx
      .update(manifest)
      .set({
        state: input.accepted ? 'committed' : 'rejected',
        ...(input.accepted ? { committedAt: this.clock.now() } : {}),
        ...(input.accepted ? {} : input.rejectionReasonCode !== undefined ? { rejectionReasonCode: input.rejectionReasonCode } : {}),
      })
      .where(and(
        eq(manifest.manifestId, manifestId),
        inArray(manifest.state, [...MANIFEST_FINALIZABLE_STATES]),
      ))
      .returning({ manifestId: manifest.manifestId });
    if (updated.length === 0) {
      throw new ManifestStateInvalidTransitionError(manifestId, [...MANIFEST_FINALIZABLE_STATES]);
    }
  }

  // Intake-request event: enqueues the manifest for worker-side validation.
  // Tri-write so audit + sync_change_feed record the request; outbox row is
  // routed to the intake queue (manifest_intake.requested -> intake) by the
  // outbox-routing policy. Emitted in commitUpload's tx alongside the verifying
  // transition so a committed upload always has a corresponding intake job.
  private async emitManifestIntakeRequestedEvent(
    tx: Tx,
    session: typeof uploadSession.$inferSelect,
    op: OperatorContext,
  ): Promise<void> {
    // Outbox-only (NOT a tri-write): manifest_intake.requested is an internal
    // queue trigger asking the worker to validate the uploaded object, not an
    // auditable domain state change. The manifest is already in 'verifying' from
    // commitUpload; the real audited facts are manifest.committed/.rejected,
    // written by finalizeIntake.
    //
    // Payload = routing envelope ({aggregateType,eventType}) + the intake job
    // BODY. The outbox relay routes on the envelope then enqueues the body
    // (envelope stripped) as the BullMQ job, which the worker strict-parses with
    // IntakeJobDataWireSchema (@fleet/sync-protocol). actual*/computedHash/
    // virusScanClean are null here; the worker fills them during S3 HEAD + hash +
    // scan. providedHash carries the client-supplied hash (if any) for the
    // worker's hash_mismatch check.
    if (!session.manifestId) throw new UploadSessionMissingManifestError(session.uploadSessionId);
    const serverSeq = await allocateServerSeq(tx);
    await tx.insert(outbox).values({
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      queueName: OUTBOX_QUEUES.INTAKE,
      payload: {
        aggregateType: 'manifest_intake',
        eventType: 'manifest_intake.requested',
        serverSeq: serverSeq.toString(),
        manifestId: session.manifestId,
        uploadSessionId: session.uploadSessionId,
        s3Key: session.s3Key,
        s3Bucket: session.s3Bucket,
        expectedContentType: session.contentType,
        expectedSizeBytes: session.expectedSizeBytes ?? session.actualSizeBytes ?? 0,
        maxSizeBytes: MANIFEST_MAX_SIZE_BYTES,
        actualContentType: null,
        actualSizeBytes: null,
        providedHash: session.contentHash,
        computedHash: null,
        virusScanClean: null,
      },
    });
  }
  // Tri-write event via shared appendTriWrite helper.
  // Deterministic seam: actionId via injected IdGenerator, timestamps via injected Clock
  // (see common/clock.ts + common/id-generator.ts). Fakes substitute both under test.
  private async emitManifestCommittedEvent(
    tx: Tx,
    manifestId: string,
    uploadSessionId: string,
    op: OperatorContext,
  ): Promise<void> {
    const serverSeq = await allocateServerSeq(tx);
    await appendTriWrite(tx, {
      serverSeq,
      actionId: this.ids.uuid(),
      aggregateType: 'manifest',
      aggregateId: manifestId,
      delta: { state: 'committed' },
      eventType: 'manifest.committed',
      auditPayload: { uploadSessionId },
      operatorId: op.operatorId,
      queueName: OUTBOX_QUEUES.ERP,
      outboxPayload: { aggregateType: 'manifest', eventType: 'manifest.committed', manifestId },
      op,
    });
  }

  /** Worker callback (POST /upload/extraction-result): persist the VLM-parsed
   *  net weight on the committed manifest and emit manifest.net_weight_extracted
   *  (-> projections) so the dispatch board picks it up. not_found/unreadable
   *  record nothing (kg stays null) and emit nothing — extraction is best-effort
   *  enrichment, never a state machine transition. */
  async finalizeExtraction(input: {
    readonly manifestId: string;
    readonly status: 'extracted' | 'not_found' | 'unreadable';
    readonly extractedNetWeightKg: number | null;
    readonly reason?: 'unparseable' | 'below_sanity_min' | 'above_sanity_max' | 'no_field' | 'object_missing' | undefined;
  }, op: OperatorContext): Promise<{ manifestId: string; status: 'extracted' | 'not_found' | 'unreadable' }> {
    return this.db.transaction(async (tx) => {
      if (input.status !== 'extracted' || input.extractedNetWeightKg === null) {
        // Persist the terminal status even when there is no kg, so the board can
        // distinguish not_found/unreadable ("needs entry") from pending
        // ("processing"). No projection event: there is no value to show, but the
        // status itself is a write (closes the silent-failure gap). Best-effort:
        // a manifest no longer 'committed' simply isn't updated (0 rows, no throw).
        await tx
          .update(manifest)
          .set({ extractionStatus: input.status, extractionReason: input.reason ?? null })
          .where(and(
            eq(manifest.manifestId, input.manifestId),
            eq(manifest.companyId, op.companyId),
            eq(manifest.state, 'committed'),
          ));
        return { manifestId: input.manifestId, status: input.status };
      }
      const updated = await tx
        .update(manifest)
        .set({ extractedNetWeightKg: input.extractedNetWeightKg.toString(), extractionStatus: 'extracted', extractionReason: null })
        .where(and(
          eq(manifest.manifestId, input.manifestId),
          eq(manifest.companyId, op.companyId),
          eq(manifest.state, 'committed'),
        ))
        .returning({ manifestId: manifest.manifestId });
      if (updated.length === 0) {
        throw new ManifestStateInvalidTransitionError(input.manifestId, ['committed']);
      }
      const serverSeq = await allocateServerSeq(tx);
      await appendTriWrite(tx, {
        serverSeq,
        actionId: this.ids.uuid(),
        aggregateType: 'manifest',
        aggregateId: input.manifestId,
        delta: { extractedNetWeightKg: input.extractedNetWeightKg },
        eventType: 'manifest.net_weight_extracted',
        auditPayload: { extractedNetWeightKg: input.extractedNetWeightKg },
        operatorId: op.operatorId,
        queueName: OUTBOX_QUEUES.PROJECTIONS,
        outboxPayload: { aggregateType: 'manifest', eventType: 'manifest.net_weight_extracted', manifestId: input.manifestId, extractedNetWeightKg: input.extractedNetWeightKg },
        op,
      });
      return { manifestId: input.manifestId, status: input.status };
    });
  }

  /** Dispatcher manual net-weight entry (board edit): set extracted_net_weight_kg
   *  by hand and mark extraction_status='manual', for manifests the VLM could not
   *  read (not_found/unreadable) or got wrong. Emits manifest.net_weight_extracted
   *  (-> projections) exactly like the worker path so the board updates the same
   *  way. Only a committed manifest is editable. Closes the "DBA runs SQL" gap. */
  async setManualNetWeight(input: {
    readonly manifestId: string;
    readonly extractedNetWeightKg: number;
  }, op: OperatorContext): Promise<{ manifestId: string; status: 'manual' }> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(manifest)
        .set({ extractedNetWeightKg: input.extractedNetWeightKg.toString(), extractionStatus: 'manual' })
        .where(and(
          eq(manifest.manifestId, input.manifestId),
          eq(manifest.companyId, op.companyId),
          eq(manifest.state, 'committed'),
        ))
        .returning({ manifestId: manifest.manifestId });
      if (updated.length === 0) {
        throw new ManifestStateInvalidTransitionError(input.manifestId, ['committed']);
      }
      const serverSeq = await allocateServerSeq(tx);
      await appendTriWrite(tx, {
        serverSeq,
        actionId: this.ids.uuid(),
        aggregateType: 'manifest',
        aggregateId: input.manifestId,
        delta: { extractedNetWeightKg: input.extractedNetWeightKg },
        eventType: 'manifest.net_weight_extracted',
        auditPayload: { extractedNetWeightKg: input.extractedNetWeightKg, source: 'manual' },
        operatorId: op.operatorId,
        queueName: OUTBOX_QUEUES.PROJECTIONS,
        outboxPayload: { aggregateType: 'manifest', eventType: 'manifest.net_weight_extracted', manifestId: input.manifestId, extractedNetWeightKg: input.extractedNetWeightKg },
        op,
      });
      return { manifestId: input.manifestId, status: 'manual' };
    });
  }

  // Extraction-request event: enqueues the COMMITTED manifest for worker-side
  // VLM net-weight extraction (phieu-can). Outbox-only like the intake request
  // (internal queue trigger, not an audited domain state change); routed
  // manifest_extraction.requested -> extraction by outbox-routing policy.
  // serverSeq rides in the payload for consumer-side idempotency (at-least-once
  // relay). Body strict-parses against ExtractionJobDataWireSchema after the
  // relay strips the routing envelope.
  private async emitManifestExtractionRequestedEvent(
    tx: Tx,
    session: typeof uploadSession.$inferSelect & { manifestId: string },
    op: OperatorContext,
  ): Promise<void> {
    const serverSeq = await allocateServerSeq(tx);
    await tx.insert(outbox).values({
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      queueName: OUTBOX_QUEUES.EXTRACTION,
      payload: {
        aggregateType: 'manifest_extraction',
        eventType: 'manifest_extraction.requested',
        serverSeq: serverSeq.toString(),
        manifestId: session.manifestId,
        uploadSessionId: session.uploadSessionId,
        s3Key: session.s3Key,
        s3Bucket: session.s3Bucket,
        contentType: session.contentType,
      },
    });
  }

  // Rejection event: audit + sync_change_feed are mandatory for observability
  // (clients need to know rejection happened); outbox routes to projections,
  // NOT erp (only accepted manifests go to ERP per outbox-routing policy).
  private async emitManifestRejectedEvent(
    tx: Tx,
    manifestId: string,
    uploadSessionId: string,
    rejectionReasonCode: ManifestRejectionReason | undefined,
    op: OperatorContext,
  ): Promise<void> {
    const serverSeq = await allocateServerSeq(tx);
    await appendTriWrite(tx, {
      serverSeq,
      actionId: this.ids.uuid(),
      aggregateType: 'manifest',
      aggregateId: manifestId,
      delta: { state: 'rejected', rejectionReasonCode: rejectionReasonCode ?? null },
      eventType: 'manifest.rejected',
      auditPayload: { uploadSessionId, rejectionReasonCode: rejectionReasonCode ?? null },
      operatorId: op.operatorId,
      queueName: OUTBOX_QUEUES.PROJECTIONS,
      outboxPayload: { aggregateType: 'manifest', eventType: 'manifest.rejected', manifestId, rejectionReasonCode: rejectionReasonCode ?? null },
      op,
    });
  }
  private buildS3Key(op: OperatorContext, manifestId: string, correlationId: string, contentType: string): string {
    const ext = mime.extension(contentType);
    const safeExt = typeof ext === 'string' ? ext : 'bin';
    return `manifests/${op.companyId}/${manifestId}/${correlationId}.${safeExt}`;
  }
}
