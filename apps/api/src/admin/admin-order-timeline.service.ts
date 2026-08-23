// apps/api/src/admin/admin-order-timeline.service.ts
// Domain encapsulation for "what happened to this order?" — the typed,
// time-ordered business event stream (2026 audit-log shape) derived from the
// authoritative tables. Replaces ad-hoc psql forensics; tenant-scoped; Drizzle
// builder only (no raw SQL). Contract: @fleet/sync-protocol OrderTimelineSchema.
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { OrderTimeline, OrderTimelineEvent } from '@fleet/sync-protocol';
import { CancelReasonSchema } from '@fleet/domain';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  transportOrder,
  stop,
  roadRun,
  roadRunTransportOrder,
} from '../database/schema/transport.js';
import { manifest } from '../database/schema/manifest.js';

export interface TimelineInput {
  readonly externalRef: string;
  readonly companyId: string;
}

@Injectable()
export class AdminOrderTimelineService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  async getByExternalRef(input: TimelineInput): Promise<OrderTimeline> {
    const [order] = await this.db
      .select()
      .from(transportOrder)
      .where(
        and(
          eq(transportOrder.externalRef, input.externalRef),
          eq(transportOrder.companyId, input.companyId),
        ),
      )
      .limit(1);
    if (order === undefined) {
      throw new NotFoundException('transport order not found: ' + input.externalRef);
    }

    const events: OrderTimelineEvent[] = [];
    events.push({ eventType: 'order_created', at: order.createdAt.toISOString() });
    if (order.cancelledAt !== null) {
      events.push({
        eventType: 'order_cancelled',
        at: order.cancelledAt.toISOString(),
        // PARSED, not cast. cancellationReason is a plain text column, so it is
        // external input to this process even though the database is ours: rows
        // predate the vocabulary, and nothing at the DB level constrains it.
        // A value outside the vocabulary is legacy or corrupt data, not a
        // reason, so it degrades to null -- which the contract already admits
        // for pre-vocabulary rows -- rather than being asserted through and
        // surfacing to an admin consumer as if it were canonical.
        reason: CancelReasonSchema.safeParse(order.cancellationReason).data ?? null,
        note: order.cancellationNote,
      });
    }

    const runs = await this.db
      .select({ run: roadRun })
      .from(roadRunTransportOrder)
      .innerJoin(roadRun, eq(roadRun.roadRunId, roadRunTransportOrder.roadRunId))
      .where(eq(roadRunTransportOrder.transportOrderId, order.transportOrderId));
    for (const { run } of runs) {
      events.push({
        eventType: 'run_created',
        at: run.createdAt.toISOString(),
        roadRunId: run.roadRunId,
      });
      if (run.startedAt !== null) {
        events.push({
          eventType: 'run_started',
          at: run.startedAt.toISOString(),
          roadRunId: run.roadRunId,
        });
      }
      if (run.completedAt !== null) {
        events.push({
          eventType: 'run_completed',
          at: run.completedAt.toISOString(),
          roadRunId: run.roadRunId,
        });
      }
    }

    const stops = await this.db
      .select()
      .from(stop)
      .where(eq(stop.transportOrderId, order.transportOrderId));
    for (const s of stops) {
      if (s.arrivedAt !== null) {
        events.push({
          eventType: 'stop_arrived',
          at: s.arrivedAt.toISOString(),
          stopSequence: s.sequence,
          stopType: s.stopType,
        });
      }
      if (s.departedAt !== null) {
        events.push({
          eventType: 'stop_departed',
          at: s.departedAt.toISOString(),
          stopSequence: s.sequence,
          stopType: s.stopType,
        });
      }
    }

    const manifests = await this.db
      .select({ m: manifest, boundSeq: stop.sequence })
      .from(manifest)
      .leftJoin(stop, eq(stop.stopId, manifest.stopId))
      .where(eq(manifest.transportOrderId, order.transportOrderId));
    for (const { m, boundSeq } of manifests) {
      const boundStopSequence = boundSeq ?? null;
      events.push({
        eventType: 'manifest_negotiated',
        at: m.createdAt.toISOString(),
        manifestId: m.manifestId,
        boundStopSequence,
      });
      if (m.state === 'committed' && m.committedAt !== null) {
        events.push({
          eventType: 'manifest_committed',
          at: m.committedAt.toISOString(),
          manifestId: m.manifestId,
          boundStopSequence,
        });
      }
      if (m.state === 'rejected') {
        events.push({
          eventType: 'manifest_rejected',
          at: (m.committedAt ?? m.createdAt).toISOString(),
          manifestId: m.manifestId,
          boundStopSequence,
          reasonText: m.rejectionReasonText,
        });
      }
    }

    events.sort((a, b) =>
      a.at === b.at ? a.eventType.localeCompare(b.eventType) : a.at.localeCompare(b.at),
    );
    return { externalRef: input.externalRef, transportOrderId: order.transportOrderId, events };
  }
}
