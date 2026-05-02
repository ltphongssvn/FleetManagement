// apps/api/src/manifest/manifest.service.ts
// Manifest service per Frozen Stack PDF "Manifest" + "Uploads".
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import mime from 'mime-types';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { manifest, uploadSession } from '../database/schema/manifest.js';
import { fleetAuditLog, syncChangeFeed, outbox } from '../database/schema/index.js';
import { transportOrder } from '../database/schema/transport.js';
import { BLOB_STORE, type IBlobStore } from '../storage/storage-provider.interface.js';
import type { Env } from '../config/env.config.js';
import type { NegotiateUploadInput, NegotiateUploadResponse, CommitUploadInput, CommitUploadResponse } from './manifest.dto.js';
import { ManifestInsertFailedError, TransportOrderNotOwnedError, UploadSessionInsertFailedError, UploadSessionMissingManifestError, UploadSessionNotFoundError, UploadAlreadyCommittedError } from './manifest.errors.js';

import type { OperatorContext } from '../auth/operator-context.js';
export type { OperatorContext };

@Injectable()
export class ManifestService {
  private readonly presignTtlSeconds: number;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(BLOB_STORE) private readonly blobs: IBlobStore,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.presignTtlSeconds = config.getOrThrow('S3_PRESIGN_TTL_SECONDS', { infer: true });
  }

  async negotiateUpload(input: NegotiateUploadInput, op: OperatorContext): Promise<NegotiateUploadResponse> {
    return this.db.transaction(async (tx) => {
      await this.assertTransportOrderOwnership(tx, input.transportOrderId, op);
      const manifestRow = await this.findOrCreateManifest(tx, input, op);
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

  private async findOrCreateManifest(tx: FleetDb, input: NegotiateUploadInput, op: OperatorContext): Promise<{ manifestId: string }> {
    const [created] = await tx
      .insert(manifest)
      .values({
        transportOrderId: input.transportOrderId,
        manifestCorrelationId: input.manifestCorrelationId,
        capturedByOperatorId: op.operatorId,
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

  private async assertTransportOrderOwnership(
    tx: FleetDb,
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
          inArray(uploadSession.state, ['initiated', 'uploading']),
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
        throw new UploadAlreadyCommittedError(input.uploadSessionId);
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
          inArray(manifest.state, ['pending', 'verifying']),
        ));

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
    readonly rejectionReasonCode?: string;
  }, op: OperatorContext): Promise<{ manifestId: string; state: 'committed' | 'rejected' }> {
    return this.db.transaction(async (tx) => {
      const targetUploadState = input.accepted ? 'committed' : 'rejected';

      const updated = await tx
        .update(uploadSession)
        .set({
          state: targetUploadState,
          ...(input.accepted ? { committedAt: new Date() } : { abortedAt: new Date() }),
        })
        .where(and(
          eq(uploadSession.uploadSessionId, input.uploadSessionId),
          eq(uploadSession.companyId, op.companyId),
          inArray(uploadSession.state, ['verifying']),
        ))
        .returning();
      const session = updated[0];
      if (!session) throw new UploadSessionNotFoundError(input.uploadSessionId);
      if (!session.manifestId) throw new UploadSessionMissingManifestError(input.uploadSessionId);

      await tx
        .update(manifest)
        .set({
          state: input.accepted ? 'committed' : 'rejected',
          ...(input.accepted ? { committedAt: new Date() } : {}),
          ...(input.accepted ? {} : { rejectionReasonCode: input.rejectionReasonCode as 'other' | undefined }),
        })
        .where(and(
          eq(manifest.manifestId, session.manifestId),
          inArray(manifest.state, ['verifying']),
        ));

      // Three append paths for the manifest.committed event so outbox-routing
      // can dispatch to ERP queue (per @fleet/sync-protocol routeOutboxRow).
      if (input.accepted) {
        const seqRow = await tx
          .select({ maxSeq: sql<string>`COALESCE(MAX(${syncChangeFeed.serverSeq}), 0)::text` })
          .from(syncChangeFeed)
          .where(eq(syncChangeFeed.companyId, op.companyId));
        const nextSeq = BigInt(seqRow[0]?.maxSeq ?? '0') + 1n;
        const evtActionId = randomUUID();

        await tx.insert(syncChangeFeed).values({
          serverSeq: nextSeq,
          actionId: evtActionId,
          aggregateType: 'manifest',
          aggregateId: session.manifestId,
          delta: { state: 'committed' },
          companyId: op.companyId,
          businessUnitId: op.businessUnitId,
          depotId: op.depotId,
          legalEntityId: op.legalEntityId,
        });

        await tx.insert(fleetAuditLog).values({
          serverSeq: nextSeq,
          operatorId: op.operatorId,
          eventType: 'manifest.committed',
          aggregateType: 'manifest',
          aggregateId: session.manifestId,
          payload: { uploadSessionId: input.uploadSessionId },
          companyId: op.companyId,
          businessUnitId: op.businessUnitId,
          depotId: op.depotId,
          legalEntityId: op.legalEntityId,
        });

        await tx.insert(outbox).values({
          queueName: 'erp',
          payload: { aggregateType: 'manifest', eventType: 'manifest.committed', manifestId: session.manifestId, serverSeq: nextSeq.toString() },
          companyId: op.companyId,
          businessUnitId: op.businessUnitId,
          depotId: op.depotId,
          legalEntityId: op.legalEntityId,
        });
      }

      return { manifestId: session.manifestId, state: input.accepted ? 'committed' : 'rejected' };
    });
  }
  private buildS3Key(op: OperatorContext, manifestId: string, correlationId: string, contentType: string): string {
    const ext = mime.extension(contentType);
    const safeExt = typeof ext === 'string' ? ext : 'bin';
    return `manifests/${op.companyId}/${manifestId}/${correlationId}.${safeExt}`;
  }
}
