// apps/api/src/manifest/manifest.service.ts
// Manifest service per Frozen Stack PDF "Manifest" + "Uploads".
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import mime from 'mime-types';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { manifest, uploadSession } from '../database/schema/manifest.js';
import { transportOrder } from '../database/schema/transport.js';
import { BLOB_STORE, type IBlobStore } from '../storage/storage-provider.interface.js';
import type { Env } from '../config/env.config.js';
import type { NegotiateUploadInput, NegotiateUploadResponse } from './manifest.dto.js';
import { ManifestInsertFailedError, TransportOrderNotOwnedError, UploadSessionInsertFailedError } from './manifest.errors.js';

export interface OperatorContext {
  readonly operatorId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
}

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

  private buildS3Key(op: OperatorContext, manifestId: string, correlationId: string, contentType: string): string {
    const ext = mime.extension(contentType);
    const safeExt = typeof ext === 'string' ? ext : 'bin';
    return `manifests/${op.companyId}/${manifestId}/${correlationId}.${safeExt}`;
  }
}
