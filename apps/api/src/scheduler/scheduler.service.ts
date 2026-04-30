// apps/api/src/scheduler/scheduler.service.ts
// PDF Day-One: outbox relay + projection runner must drain continuously.
// Self-scheduling setTimeout prevents overlapping execution: next tick fires
// only AFTER the current drain completes. Multi-instance safety relies on
// FOR UPDATE SKIP LOCKED in outbox-relay + projection-runner.
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
    this.pilotScope = config.getOrThrow('FLEET_PILOT_SCOPE', { infer: true });
  }

  onModuleInit(): void {
    this.scheduleNext('outbox');
    this.scheduleNext('projection');
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.outboxTimer) clearTimeout(this.outboxTimer);
    if (this.projectionTimer) clearTimeout(this.projectionTimer);
  }

  private scheduleNext(kind: 'outbox' | 'projection'): void {
    if (this.stopped) return;
    const tick = (): void => { void this.runDrain(kind); };
    if (kind === 'outbox') this.outboxTimer = setTimeout(tick, DRAIN_INTERVAL_MS);
    else this.projectionTimer = setTimeout(tick, DRAIN_INTERVAL_MS);
  }

  private async runDrain(kind: 'outbox' | 'projection'): Promise<void> {
    try {
      if (kind === 'outbox') await this.outboxRelay.drainOnce();
      else await this.projectionRunner.drainOnce(this.pilotScope);
    } catch (err: unknown) {
      const label = kind === 'outbox' ? 'Outbox drain failed: ' : 'Projection drain failed: ';
      if (err instanceof Error) {
        this.logger.error(label + err.message, err.stack);
      } else {
        this.logger.error(label + String(err));
      }
    } finally {
      this.scheduleNext(kind);
    }
  }

  async drainOutbox(): Promise<void> { await this.runDrain('outbox'); }
  async drainProjections(): Promise<void> { await this.runDrain('projection'); }
}
