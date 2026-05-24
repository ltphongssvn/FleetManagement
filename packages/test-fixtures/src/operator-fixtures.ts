// packages/test-fixtures/src/operator-fixtures.ts
// Factory builders for OperatorContext + SyncAction. Eliminates WET test data
// boilerplate across api/worker/driver-app suites. All builders return frozen
// objects so accidental mutation in one test cannot leak into another.
import { randomUUID } from 'node:crypto';
import type { OperatorContext } from '@fleet/domain';

export interface SyncActionLike {
  readonly actionId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
}

export function createOperatorContext(overrides: Partial<OperatorContext> = {}): OperatorContext {
  return Object.freeze({
    operatorId: randomUUID(),
    companyId: randomUUID(),
    businessUnitId: randomUUID(),
    depotId: randomUUID(),
    legalEntityId: randomUUID(),
    ...overrides,
  } satisfies OperatorContext);
}

export function createSyncAction(overrides: Partial<SyncActionLike> = {}): SyncActionLike {
  return Object.freeze({
    actionId: randomUUID(),
    aggregateType: 'transport_order',
    aggregateId: randomUUID(),
    payload: {},
    timestamp: new Date('2026-04-30T00:00:00.000Z').toISOString(),
    ...overrides,
  } satisfies SyncActionLike);
}

// Re-export for backward compat with existing test imports
export type { OperatorContext as OperatorContextLike } from '@fleet/domain';
