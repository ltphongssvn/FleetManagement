// apps/api/src/database/append-tri-write.ts
// Centralizes the 3 append paths (sync_change_feed + fleet_audit_log + outbox)
// per Frozen Stack PDF "Three append paths, same tx". Replaces ~25-line copy-paste
// across commands.service, manifest.service, sync.service, transport-orders.service.
//
// idempotent=true wires onConflictDoNothing on action_id (used by commands.service
// for replay-safe command persistence). When duplicate, audit + outbox are skipped.
import { sql } from 'drizzle-orm';
import { fleetAuditLog, syncChangeFeed, outbox } from './schema/index.js';
import type { FleetDb } from './database.module.js';
import type { OperatorContext } from '../auth/operator-context.js';

type TxLike = Parameters<Parameters<FleetDb['transaction']>[0]>[0];

export interface AppendTriWriteParams {
  readonly serverSeq: bigint;
  readonly actionId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly delta: Record<string, unknown>;
  readonly eventType: string;
  readonly auditPayload: Record<string, unknown>;
  readonly operatorId?: string;
  readonly queueName: string;
  readonly outboxPayload: Record<string, unknown>;
  readonly op: OperatorContext;
  readonly idempotent?: boolean;
}

export interface AppendTriWriteResult {
  /** True when actionId already existed (idempotent replay). audit/outbox skipped. */
  readonly duplicate: boolean;
}

export async function appendTriWrite(
  tx: TxLike,
  params: AppendTriWriteParams,
): Promise<AppendTriWriteResult> {
  const tenancy = {
    companyId: params.op.companyId,
    businessUnitId: params.op.businessUnitId,
    depotId: params.op.depotId,
    legalEntityId: params.op.legalEntityId,
  };

  if (params.idempotent === true) {
    const inserted = await tx.insert(syncChangeFeed).values({
      ...tenancy,
      serverSeq: params.serverSeq,
      actionId: params.actionId,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      delta: params.delta,
    })
    .onConflictDoNothing({ target: syncChangeFeed.actionId })
    .returning({ feedId: syncChangeFeed.feedId });
    if (inserted.length === 0) return { duplicate: true };
  } else {
    await tx.insert(syncChangeFeed).values({
      ...tenancy,
      serverSeq: params.serverSeq,
      actionId: params.actionId,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      delta: params.delta,
    });
  }

  await tx.insert(fleetAuditLog).values({
    ...tenancy,
    serverSeq: params.serverSeq,
    ...(params.operatorId !== undefined ? { operatorId: params.operatorId } : {}),
    eventType: params.eventType,
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    payload: params.auditPayload,
  });

  await tx.insert(outbox).values({
    ...tenancy,
    queueName: params.queueName,
    payload: { ...params.outboxPayload, serverSeq: params.serverSeq.toString() },
  });

  return { duplicate: false };
}

// Suppress unused import warning when only used in advanced overloads.
void sql;
