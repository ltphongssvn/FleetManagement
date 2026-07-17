// apps/api/src/manifest/intake-redrive.builder.ts
// Pure builder for the intake backlog redrive (Jun-24 incident repair):
// compensating manifest_intake.requested outbox rows for manifests stranded
// in verifying by the expired worker token. Event-sourcing repair protocol:
// events go THROUGH the pipeline (outbox -> relay -> BullMQ -> worker ->
// finalizeIntake); manifest state is never hand-patched. Duplicate delivery
// is inert: finalizeIntake FSM guards reject a second transition, matching
// the at-least-once contract.
// Contract parity with emitManifestIntakeRequestedEvent (manifest.service):
// envelope {aggregateType,eventType,serverSeq} + IntakeJobDataWireSchema
// body. The body is STRICT-PARSED with the SSOT schema before returning, so
// an incomplete session (missing s3Key/bucket/size) fails HERE, loudly, and
// never becomes a poison job.
import { IntakeJobDataWireSchema, MANIFEST_MAX_SIZE_BYTES, OUTBOX_QUEUES } from '@fleet/sync-protocol';

export interface IntakeRedriveCandidate {
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly manifestId: string;
  readonly uploadSessionId: string;
  readonly s3Key: string | null;
  readonly s3Bucket: string | null;
  readonly contentType: string;
  readonly expectedSizeBytes: number | null;
  readonly actualSizeBytes: number | null;
  readonly contentHash: string | null;
}

export interface IntakeRedriveOutboxValues {
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly queueName: string;
  readonly payload: Record<string, unknown>;
}

export function buildIntakeRedriveOutboxValues(
  candidate: IntakeRedriveCandidate,
  serverSeq: bigint,
): IntakeRedriveOutboxValues {
  const body = IntakeJobDataWireSchema.parse({
    manifestId: candidate.manifestId,
    uploadSessionId: candidate.uploadSessionId,
    s3Key: candidate.s3Key,
    s3Bucket: candidate.s3Bucket,
    expectedContentType: candidate.contentType,
    expectedSizeBytes: candidate.expectedSizeBytes ?? candidate.actualSizeBytes,
    maxSizeBytes: MANIFEST_MAX_SIZE_BYTES,
    actualContentType: null,
    actualSizeBytes: null,
    providedHash: candidate.contentHash,
    computedHash: null,
    virusScanClean: null,
  });
  return {
    companyId: candidate.companyId,
    businessUnitId: candidate.businessUnitId,
    depotId: candidate.depotId,
    legalEntityId: candidate.legalEntityId,
    queueName: OUTBOX_QUEUES.INTAKE,
    payload: {
      aggregateType: 'manifest_intake',
      eventType: 'manifest_intake.requested',
      serverSeq: serverSeq.toString(),
      ...body,
    },
  };
}
