// apps/api/src/scheduler/scheduler.service.ts
// PDF Day-One: outbox relay + projection runner must drain continuously.
// Self-scheduling setTimeout prevents overlapping execution: next tick fires
// only AFTER the current drain completes. Drain duration is variable (DB +
// Redis + BullMQ enqueue), so blind cron risks concurrent runs. Multi-instance
// safety relies on FOR UPDATE SKIP LOCKED in outbox-relay + projection-runner.
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxRelayService } from '../outbox/outbox-relay.service.js';
import { ProjectionRunnerService } from '../projections/projection-runner.service.js';
import type { Env } from '../config/env.config.js';

const DRAIN_INTERVAL_MS = 5_000;

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly pilotScope: string;
  private outboxTimer: NodeJS.Timeout | null = null;
  private projectionTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly outboxRelay: OutboxRelayService,
    private readonly projectionRunner: ProjectionRunnerService,
    config: ConfigService<Env, true>,
  ) {
    this.pilotScope = config.get('FLEET_PILOT_SCOPE', { infer: true });
  }

  onModuleInit(): void {
    this.scheduleNextOutbox();
    this.scheduleNextProjection();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.outboxTimer) clearTimeout(this.outboxTimer);
    if (this.projectionTimer) clearTimeout(this.projectionTimer);
  }

  private scheduleNextOutbox(): void {
    if (this.stopped) return;
    this.outboxTimer = setTimeout(() => { void this.drainOutbox(); }, DRAIN_INTERVAL_MS);
  }

  private scheduleNextProjection(): void {
    if (this.stopped) return;
    this.projectionTimer = setTimeout(() => { void this.drainProjections(); }, DRAIN_INTERVAL_MS);
  }

  async drainOutbox(): Promise<void> {
    try {
      await this.outboxRelay.drainOnce();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Outbox drain failed: ' + msg);
    } finally {
      this.scheduleNextOutbox();
    }
  }

  async drainProjections(): Promise<void> {
    try {
      await this.projectionRunner.drainOnce(this.pilotScope);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Projection drain failed: ' + msg);
    } finally {
      this.scheduleNextProjection();
    }
  }
}
