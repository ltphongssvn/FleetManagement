// apps/api/src/scheduler/scheduler.service.ts
// PDF Day-One: outbox relay + projection runner must drain continuously.
// Self-scheduling setTimeout prevents overlapping execution: next tick fires
// only AFTER the current drain completes. Multi-instance safety relies on
// FOR UPDATE SKIP LOCKED in outbox-relay + projection-runner.
//
// The break-glass poll ('breakglass' kind, 60s) is an OPTIONAL sibling tick: it
// schedules only when a BreakGlassLoginMonitorService is injected (present iff
// KEYCLOAK_MONITOR_CLIENT_SECRET is set - dormant otherwise). See the runbook.
import { Inject, Injectable, Logger, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { OutboxRelayService } from '../outbox/outbox-relay.service.js';
import { ProjectionRunnerService } from '../projections/projection-runner.service.js';
import { CommandsGateway } from '../commands/commands.gateway.js';
import type { BreakGlassLoginMonitorService } from '../security/break-glass-login-monitor.service.js';
import type { IntakeLagMonitorService } from '../manifest/intake-lag-monitor.service.js';
import type { IntakeReconcilerService } from '../manifest/intake-reconciler.service.js';
import type { CompletionReconcilerService } from '../manifest/completion-reconciler.service.js';
import type { CompletionReconcilerMonitorService } from '../maintenance/completion-reconciler-monitor.service.js';
import type { Env } from '../config/env.config.js';

export const BREAKGLASS_MONITOR = 'BREAKGLASS_MONITOR' as const;
export const INTAKE_LAG_MONITOR = 'INTAKE_LAG_MONITOR' as const;
export const INTAKE_RECONCILER = 'INTAKE_RECONCILER' as const;
export const COMPLETION_RECONCILER = 'COMPLETION_RECONCILER' as const;
export const COMPLETION_RECONCILER_MONITOR = 'COMPLETION_RECONCILER_MONITOR' as const;

const DRAIN_INTERVAL_MS = 5_000;
const RECONCILE_INTERVAL_MS = 2_000;
const BREAKGLASS_INTERVAL_MS = 60_000;
const INTAKE_LAG_INTERVAL_MS = 300_000;
// Reconciler tick: same 5-min cadence as the lag monitor. Backoff gating
// lives in the query, so a frequent tick is cheap and shortens recovery.
const INTAKE_RECONCILE_INTERVAL_MS = 300_000;
// Completion reconciler tick: same 5-min cadence. A frequent, cheap
// level-triggered sweep that heals any delivered run the edge-trigger
// missed, across all tenants, within one interval.
const COMPLETION_RECONCILE_INTERVAL_MS = 300_000;
// Completion-stranded monitor tick: same 5-min cadence as the lag monitor.
// Threshold gating lives in the query/service, so a frequent tick is cheap.
const COMPLETION_MONITOR_INTERVAL_MS = 300_000;

type SchedulerKind = 'outbox' | 'projection' | 'reconciler' | 'breakglass' | 'intakeLag' | 'intakeReconcile' | 'completionReconcile' | 'completionMonitor';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly pilotScope: string;
  private outboxTimer: NodeJS.Timeout | null = null;
  private projectionTimer: NodeJS.Timeout | null = null;
  private reconcilerTimer: NodeJS.Timeout | null = null;
  private breakglassTimer: NodeJS.Timeout | null = null;
  private intakeLagTimer: NodeJS.Timeout | null = null;
  private intakeReconcileTimer: NodeJS.Timeout | null = null;
  private completionReconcileTimer: NodeJS.Timeout | null = null;
  private completionMonitorTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  constructor(
    private readonly outboxRelay: OutboxRelayService,
    private readonly projectionRunner: ProjectionRunnerService,
    config: ConfigService<Env, true>,
    private readonly commandsGateway: CommandsGateway,
    @Optional()
    @Inject(BREAKGLASS_MONITOR)
    private readonly breakGlassMonitor: BreakGlassLoginMonitorService | null = null,
    @Optional()
    @Inject(INTAKE_LAG_MONITOR)
    private readonly intakeLagMonitor: IntakeLagMonitorService | null = null,
    @Optional()
    @Inject(INTAKE_RECONCILER)
    private readonly intakeReconciler: IntakeReconcilerService | null = null,
    @Optional()
    @Inject(COMPLETION_RECONCILER)
    private readonly completionReconciler: CompletionReconcilerService | null = null,
    @Optional()
    @Inject(COMPLETION_RECONCILER_MONITOR)
    private readonly completionMonitor: CompletionReconcilerMonitorService | null = null,
  ) {
    this.pilotScope = config.getOrThrow('FLEET_PILOT_SCOPE', { infer: true });
  }
  onModuleInit(): void {
    this.scheduleNext('outbox');
    this.scheduleNext('projection');
    this.scheduleNext('reconciler');
    if (this.breakGlassMonitor !== null) this.scheduleNext('breakglass');
    if (this.intakeLagMonitor !== null) this.scheduleNext('intakeLag');
    if (this.intakeReconciler !== null) this.scheduleNext('intakeReconcile');
    if (this.completionReconciler !== null) this.scheduleNext('completionReconcile');
    if (this.completionMonitor !== null) this.scheduleNext('completionMonitor');
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
    if (this.breakglassTimer !== null) {
      clearTimeout(this.breakglassTimer);
      this.breakglassTimer = null;
    }
    if (this.intakeLagTimer !== null) {
      clearTimeout(this.intakeLagTimer);
      this.intakeLagTimer = null;
    }
    if (this.intakeReconcileTimer !== null) {
      clearTimeout(this.intakeReconcileTimer);
      this.intakeReconcileTimer = null;
    }
    if (this.completionReconcileTimer !== null) {
      clearTimeout(this.completionReconcileTimer);
      this.completionReconcileTimer = null;
    }
    if (this.completionMonitorTimer !== null) {
      clearTimeout(this.completionMonitorTimer);
      this.completionMonitorTimer = null;
    }
    this.stopped = true;
  }

  private scheduleNext(kind: SchedulerKind): void {
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
      case 'breakglass':
        this.breakglassTimer = setTimeout(tick, BREAKGLASS_INTERVAL_MS);
        return;
      case 'intakeLag':
        this.intakeLagTimer = setTimeout(tick, INTAKE_LAG_INTERVAL_MS);
        return;
      case 'intakeReconcile':
        this.intakeReconcileTimer = setTimeout(tick, INTAKE_RECONCILE_INTERVAL_MS);
        return;
      case 'completionReconcile':
        this.completionReconcileTimer = setTimeout(tick, COMPLETION_RECONCILE_INTERVAL_MS);
        return;
      case 'completionMonitor':
        this.completionMonitorTimer = setTimeout(tick, COMPLETION_MONITOR_INTERVAL_MS);
        return;
      default: {
        const _exhaustive: never = kind;
        throw new Error('unknown scheduler kind: ' + String(_exhaustive));
      }
    }
  }

  private tagFor(kind: SchedulerKind): string {
    switch (kind) {
      case 'outbox': return 'outbox-drain';
      case 'projection': return 'projection-drain';
      case 'reconciler': return 'commands-reconciler';
      case 'breakglass': return 'breakglass-scan';
      case 'intakeLag': return 'intake-lag-check';
      case 'intakeReconcile': return 'intake-reconcile';
      case 'completionReconcile': return 'completion-reconcile';
      case 'completionMonitor': return 'completion-monitor-check';
      default: {
        const _exhaustive: never = kind;
        throw new Error('unknown scheduler kind: ' + String(_exhaustive));
      }
    }
  }
  private labelFor(kind: SchedulerKind): string {
    switch (kind) {
      case 'outbox': return 'Outbox drain failed: ';
      case 'projection': return 'Projection drain failed: ';
      case 'reconciler': return 'Reconciler tick failed: ';
      case 'breakglass': return 'Break-glass poll failed: ';
      case 'intakeLag': return 'Intake-lag check failed: ';
      case 'intakeReconcile': return 'Intake reconcile failed: ';
      case 'completionReconcile': return 'Completion reconcile failed: ';
      case 'completionMonitor': return 'Completion monitor check failed: ';
      default: {
        const _exhaustive: never = kind;
        throw new Error('unknown scheduler kind: ' + String(_exhaustive));
      }
    }
  }
  private async invokeDrain(kind: SchedulerKind): Promise<void> {
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
      case 'breakglass':
        if (this.breakGlassMonitor !== null) await this.breakGlassMonitor.pollOnce();
        return;
      case 'intakeLag':
        if (this.intakeLagMonitor !== null) await this.intakeLagMonitor.checkOnce();
        return;
      case 'intakeReconcile':
        if (this.intakeReconciler !== null) await this.intakeReconciler.reconcileOnce();
        return;
      case 'completionReconcile':
        if (this.completionReconciler !== null) await this.completionReconciler.reconcileOnce();
        return;
      case 'completionMonitor':
        if (this.completionMonitor !== null) await this.completionMonitor.checkOnce();
        return;
      default: {
        const _exhaustive: never = kind;
        throw new Error('unknown scheduler kind: ' + String(_exhaustive));
      }
    }
  }
  private async runDrain(kind: SchedulerKind): Promise<void> {
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
  async drainBreakglass(): Promise<void> { await this.runDrain('breakglass'); }
  async drainIntakeLag(): Promise<void> { await this.runDrain('intakeLag'); }
  async drainIntakeReconcile(): Promise<void> { await this.runDrain('intakeReconcile'); }
  async drainCompletionReconcile(): Promise<void> { await this.runDrain('completionReconcile'); }
  async drainCompletionMonitor(): Promise<void> { await this.runDrain('completionMonitor'); }
}
