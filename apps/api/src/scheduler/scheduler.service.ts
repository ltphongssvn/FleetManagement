// apps/api/src/scheduler/scheduler.service.ts
// PDF Day-One: outbox relay + projection runner must drain continuously.
// Self-scheduling setTimeout prevents overlapping execution: next tick fires
// only AFTER the current drain completes. Multi-instance safety relies on
// FOR UPDATE SKIP LOCKED in outbox-relay + projection-runner.
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { OutboxRelayService } from '../outbox/outbox-relay.service.js';
import { ProjectionRunnerService } from '../projections/projection-runner.service.js';
import { CommandsGateway } from '../commands/commands.gateway.js';
import type { Env } from '../config/env.config.js';

const DRAIN_INTERVAL_MS = 5_000;
const RECONCILE_INTERVAL_MS = 2_000;

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly pilotScope: string;
  private outboxTimer: NodeJS.Timeout | null = null;
  private projectionTimer: NodeJS.Timeout | null = null;
  private reconcilerTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly outboxRelay: OutboxRelayService,
    private readonly projectionRunner: ProjectionRunnerService,
    config: ConfigService<Env, true>,
    private readonly commandsGateway: CommandsGateway,
  ) {
    this.pilotScope = config.getOrThrow('FLEET_PILOT_SCOPE', { infer: true });
  }

  onModuleInit(): void {
    this.scheduleNext('outbox');
    this.scheduleNext('projection');
    this.scheduleNext('reconciler');
  }

  onModuleDestroy(): void {
    if (this.outboxTimer !== null) {
      clearTimeout(this.outboxTimer);
      this.outboxTimer = null;
    }
    if (this.projectionTimer !== null) {
      clearTimeout(this.projectionTimer);
      this.projectionTimer = null;
    }
    if (this.reconcilerTimer !== null) {
      clearTimeout(this.reconcilerTimer);
      this.reconcilerTimer = null;
    }
    this.stopped = true;
  }

  private scheduleNext(kind: 'outbox' | 'projection' | 'reconciler'): void {
    if (this.stopped) return;
    const tick = (): void => { void this.runDrain(kind); };
    switch (kind) {
      case 'outbox':
        this.outboxTimer = setTimeout(tick, DRAIN_INTERVAL_MS);
        return;
      case 'projection':
        this.projectionTimer = setTimeout(tick, DRAIN_INTERVAL_MS);
        return;
      case 'reconciler':
        this.reconcilerTimer = setTimeout(tick, RECONCILE_INTERVAL_MS);
        return;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`unknown scheduler kind: ${String(_exhaustive)}`);
      }
    }
  }

  private tagFor(kind: 'outbox' | 'projection' | 'reconciler'): string {
    switch (kind) {
      case 'outbox': return 'outbox-drain';
      case 'projection': return 'projection-drain';
      case 'reconciler': return 'commands-reconciler';
      default: {
        const _exhaustive: never = kind;
        throw new Error(`unknown scheduler kind: ${String(_exhaustive)}`);
      }
    }
  }
  private labelFor(kind: 'outbox' | 'projection' | 'reconciler'): string {
    switch (kind) {
      case 'outbox': return 'Outbox drain failed: ';
      case 'projection': return 'Projection drain failed: ';
      case 'reconciler': return 'Reconciler tick failed: ';
      default: {
        const _exhaustive: never = kind;
        throw new Error(`unknown scheduler kind: ${String(_exhaustive)}`);
      }
    }
  }
  private async invokeDrain(kind: 'outbox' | 'projection' | 'reconciler'): Promise<void> {
    switch (kind) {
      case 'outbox':
        await this.outboxRelay.drainOnce();
        return;
      case 'projection':
        await this.projectionRunner.drainOnce(this.pilotScope);
        return;
      case 'reconciler':
        this.commandsGateway.reconcileNow();
        return;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`unknown scheduler kind: ${String(_exhaustive)}`);
      }
    }
  }
  private async runDrain(kind: 'outbox' | 'projection' | 'reconciler'): Promise<void> {
    // PDF Day-One #9: isolate background job breadcrumbs from HTTP request scope.
    // Sentry NestJS docs warn @Cron / BullMQ handlers leak into unrelated request errors.
    await Sentry.withIsolationScope(async (scope) => {
      scope.setTag('job', this.tagFor(kind));
      try {
        await this.invokeDrain(kind);
      } catch (err: unknown) {
        Sentry.captureException(err);
        const label = this.labelFor(kind);
        if (err instanceof Error) {
          this.logger.error(label + err.message, err.stack);
        } else {
          this.logger.error(label + String(err));
        }
      } finally {
        this.scheduleNext(kind);
      }
    });
  }

  async drainReconciler(): Promise<void> { await this.runDrain('reconciler'); }

  async drainOutbox(): Promise<void> { await this.runDrain('outbox'); }
  async drainProjections(): Promise<void> { await this.runDrain('projection'); }
}
