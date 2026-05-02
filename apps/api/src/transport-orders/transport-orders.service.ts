// apps/api/src/transport-orders/transport-orders.service.ts
// Pilot seed: creates transport_order + stops + optional road_run, plus 3
// append paths so the dispatch_board projection picks it up.
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { transportOrder, stop, roadRun, roadRunTransportOrder } from '../database/schema/transport.js';
import { fleetAuditLog, syncChangeFeed, outbox } from '../database/schema/index.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { CreateTransportOrderInput, CreateTransportOrderResponse } from './transport-orders.dto.js';

@Injectable()
export class TransportOrdersService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async create(input: CreateTransportOrderInput, op: OperatorContext): Promise<CreateTransportOrderResponse> {
    return this.db.transaction(async (tx) => {
      const tenancy = {
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      };

      const [created] = await tx.insert(transportOrder).values({
        ...tenancy,
        ...(input.externalRef !== undefined ? { externalRef: input.externalRef } : {}),
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
      }).returning();
      if (!created) throw new Error('transport_order insert failed');
      const transportOrderId = created.transportOrderId;

      for (const s of input.stops) {
        await tx.insert(stop).values({
          ...tenancy,
          transportOrderId,
          sequence: s.sequence,
          stopType: s.stopType,
          ...(s.yardId !== undefined ? { yardId: s.yardId } : {}),
          ...(s.plannedAt !== undefined ? { plannedAt: new Date(s.plannedAt) } : {}),
        });
      }

      let roadRunId: string | null = null;
      if (input.roadRun) {
        const [rr] = await tx.insert(roadRun).values({
          ...tenancy,
          ...(input.roadRun.plannedStartAt !== undefined ? { plannedStartAt: new Date(input.roadRun.plannedStartAt) } : {}),
          ...(input.roadRun.assignedOperatorId !== undefined ? { assignedOperatorId: input.roadRun.assignedOperatorId } : {}),
          ...(input.roadRun.assignedAssetId !== undefined ? { assignedAssetId: input.roadRun.assignedAssetId } : {}),
        }).returning();
        if (!rr) throw new Error('road_run insert failed');
        roadRunId = rr.roadRunId;
        await tx.insert(roadRunTransportOrder).values({
          ...tenancy,
          roadRunId,
          transportOrderId,
          sequence: 1,
        });
      }

      // 3 append paths so projection runner picks up the road_run
      if (roadRunId) {
        const seqRow = await tx
          .select({ maxSeq: sql<string>`COALESCE(MAX(${syncChangeFeed.serverSeq}), 0)::text` })
          .from(syncChangeFeed)
          .where(eq(syncChangeFeed.companyId, op.companyId));
        const nextSeq = BigInt(seqRow[0]?.maxSeq ?? '0') + 1n;
        const evtId = randomUUID();

        const refs = input.externalRef ? [input.externalRef] : [];
        await tx.insert(syncChangeFeed).values({
          ...tenancy,
          serverSeq: nextSeq,
          actionId: evtId,
          aggregateType: 'road_run',
          aggregateId: roadRunId,
          delta: {
            state: 'planned',
            assignedOperatorId: input.roadRun?.assignedOperatorId ?? null,
            assignedAssetId: input.roadRun?.assignedAssetId ?? null,
            plannedStartAt: input.roadRun?.plannedStartAt ?? null,
            stopCount: input.stops.length,
            transportOrderRefs: refs,
          },
        });
        await tx.insert(fleetAuditLog).values({
          ...tenancy,
          serverSeq: nextSeq,
          operatorId: op.operatorId,
          eventType: 'road_run.created',
          aggregateType: 'road_run',
          aggregateId: roadRunId,
          payload: { transportOrderId },
        });
        await tx.insert(outbox).values({
          ...tenancy,
          queueName: 'projections',
          payload: { aggregateType: 'road_run', eventType: 'road_run.created', roadRunId, serverSeq: nextSeq.toString() },
        });
      }

      return { transportOrderId, roadRunId };
    });
  }
}
