import { OUTBOX_QUEUES } from '@fleet/sync-protocol';
// apps/api/src/transport-orders/transport-orders.service.ts
// Pilot seed: creates transport_order + stops + optional road_run, plus 3
// append paths so the dispatch_board projection picks it up.
import { Inject, Injectable } from '@nestjs/common';

import { randomUUID } from 'node:crypto';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { transportOrder, stop, roadRun, roadRunTransportOrder } from '../database/schema/transport.js';
import { appendTriWrite } from '../database/append-tri-write.js';
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
        // Tri-write event via shared appendTriWrite helper.
        const serverSeq = await allocateServerSeq(tx);
        const refs = input.externalRef ? [input.externalRef] : [];
        await appendTriWrite(tx, {
          serverSeq,
          actionId: randomUUID(),
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
          eventType: 'road_run.created',
          auditPayload: { transportOrderId },
          operatorId: op.operatorId,
          queueName: OUTBOX_QUEUES.PROJECTIONS,
          outboxPayload: { aggregateType: 'road_run', eventType: 'road_run.created', roadRunId },
          op,
        });
      }

      return { transportOrderId, roadRunId };
    });
  }
}
