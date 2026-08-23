// packages/test-fixtures/src/payload-fixtures.ts
// Frozen factories for recurring DTO shapes — CommandPayload, NegotiateUpload,
// CommitUpload, CreateTransportOrder. Critique #7 extension of #4.
import { randomUUID } from 'node:crypto';

export type CommandTypeLike = 'assign_run' | 'reassign_run' | 'cancel_run' | 'status_update';
export interface CommandPayloadLike {
  readonly commandId: string;
  readonly type: CommandTypeLike;
  readonly targetOperatorId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly issuedAt: string;
}

export function createCommandPayload(
  overrides: Partial<CommandPayloadLike> = {},
): CommandPayloadLike {
  return Object.freeze({
    commandId: randomUUID(),
    type: 'assign_run' as CommandTypeLike,
    targetOperatorId: randomUUID(),
    aggregateType: 'road_run',
    aggregateId: randomUUID(),
    payload: {},
    issuedAt: new Date('2026-04-30T00:00:00.000Z').toISOString(),
    ...overrides,
  });
}

export interface NegotiateUploadInputLike {
  readonly manifestCorrelationId: string;
  readonly transportOrderId: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';
  readonly expectedSizeBytes: number;
}

export function createNegotiateUploadInput(
  overrides: Partial<NegotiateUploadInputLike> = {},
): NegotiateUploadInputLike {
  return Object.freeze({
    manifestCorrelationId: randomUUID(),
    transportOrderId: randomUUID(),
    contentType: 'image/jpeg' as const,
    expectedSizeBytes: 1_500_000,
    ...overrides,
  });
}

export interface CommitUploadInputLike {
  readonly uploadSessionId: string;
  readonly actualSizeBytes: number;
  readonly contentHash: string;
}

export function createCommitUploadInput(
  overrides: Partial<CommitUploadInputLike> = {},
): CommitUploadInputLike {
  return Object.freeze({
    uploadSessionId: randomUUID(),
    actualSizeBytes: 1_400_000,
    contentHash: 'a'.repeat(64),
    ...overrides,
  });
}

export interface StopLike {
  readonly sequence: number;
  readonly stopType: string;
}

export interface CreateTransportOrderInputLike {
  readonly externalRef?: string;
  readonly stops: readonly StopLike[];
  readonly roadRun?: {
    readonly plannedStartAt?: string;
    readonly assignedOperatorId?: string;
    readonly assignedAssetId?: string;
  };
}

export function createCreateTransportOrderInput(
  overrides: Partial<CreateTransportOrderInputLike> = {},
): CreateTransportOrderInputLike {
  return Object.freeze({
    externalRef: 'TO-DEFAULT',
    stops: [{ sequence: 1, stopType: 'pickup' }],
    ...overrides,
  });
}
