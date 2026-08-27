// apps/api/src/scheduler/scheduler.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OutboxModule } from '../outbox/outbox.module.js';
import { OutboxRelayService } from '../outbox/outbox-relay.service.js';
import { ProjectionsModule } from '../projections/projections.module.js';
import { ProjectionRunnerService } from '../projections/projection-runner.service.js';
import { CommandsModule } from '../commands/commands.module.js';
import { CommandsGateway } from '../commands/commands.gateway.js';
import { SchedulerService } from './scheduler.service.js';
import { SCHEDULER_TICKERS, type SchedulerTicker } from './scheduler-ticker.js';
import { KeycloakEventPollCursorService } from '../security/keycloak-event-poll-cursor.service.js';
import { KeycloakEventsClient } from '../security/keycloak-events-client.js';
import { BreakGlassLoginMonitorService } from '../security/break-glass-login-monitor.service.js';
import { IntakeLagMonitorService } from '../manifest/intake-lag-monitor.service.js';
import { DrizzleIntakeLagRepo } from '../manifest/intake-lag.repo.js';
import { IntakeReconcilerService } from '../manifest/intake-reconciler.service.js';
import { CompletionReconcilerService } from '../manifest/completion-reconciler.service.js';
import { DrizzleIntakeReconcileRepo } from '../manifest/intake-reconcile.repo.js';
import { AlertLagMonitorService } from '../manifest/alert-lag-monitor.service.js';
import { DrizzleAlertLagRepo } from '../manifest/alert-lag.repo.js';
import { DrizzleCompletionReconcileRepo } from '../manifest/completion-reconcile.repo.js';
import { CompletionReconcilerMonitorService } from '../maintenance/completion-reconciler-monitor.service.js';
import {
  DrizzleCompletionStrandedRepo,
  COMPLETION_STRANDED_PILOT_SCOPE,
} from '../maintenance/completion-stranded.repo.js';
import type { Env } from '../config/env.config.js';

// DI tokens for the optional monitors. Each is provided by a useFactory that
// returns the service or null (dormant); the SCHEDULER_TICKERS factory turns a
// non-null monitor into a ticker and skips a null one.
const BREAKGLASS_MONITOR = 'BREAKGLASS_MONITOR' as const;
const INTAKE_LAG_MONITOR = 'INTAKE_LAG_MONITOR' as const;
const INTAKE_RECONCILER = 'INTAKE_RECONCILER' as const;
const ALERT_LAG_MONITOR = 'ALERT_LAG_MONITOR' as const;
const COMPLETION_RECONCILER = 'COMPLETION_RECONCILER' as const;
const COMPLETION_RECONCILER_MONITOR = 'COMPLETION_RECONCILER_MONITOR' as const;

// Tick cadences (ms). Core relays drain fast; monitors and reconcilers sweep
// on a 5-min cadence (backoff/threshold gating lives in each query, so a
// frequent tick is cheap and shortens recovery).
const DRAIN_INTERVAL_MS = 5_000;
const RECONCILE_INTERVAL_MS = 2_000;
const BREAKGLASS_INTERVAL_MS = 60_000;
const INTAKE_LAG_INTERVAL_MS = 300_000;
const INTAKE_RECONCILE_INTERVAL_MS = 300_000;
const ALERT_LAG_INTERVAL_MS = 300_000;
const COMPLETION_RECONCILE_INTERVAL_MS = 300_000;
const COMPLETION_MONITOR_INTERVAL_MS = 300_000;

// The break-glass monitor is DORMANT unless KEYCLOAK_MONITOR_CLIENT_SECRET is
// set: its factory returns null when the secret is absent, so no ticker is
// registered. Mirrors the AWS_*/FLEET_API_* port-absent gating.
@Module({
  imports: [ConfigModule, OutboxModule, ProjectionsModule, CommandsModule],
  providers: [
    SchedulerService,
    KeycloakEventPollCursorService,
    DrizzleIntakeLagRepo,
    DrizzleIntakeReconcileRepo,
    DrizzleAlertLagRepo,
    DrizzleCompletionReconcileRepo,
    {
      // completion-stranded repo is company-scoped; supply the pilot scope from
      // config so the monitor reads the same tenant the projection runner drains.
      provide: COMPLETION_STRANDED_PILOT_SCOPE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string =>
        config.getOrThrow('FLEET_PILOT_SCOPE', { infer: true }),
    },
    DrizzleCompletionStrandedRepo,
    {
      // Intake-lag guard (Jun-24 incident class) is ALWAYS ON: needs only DB +
      // Sentry, so no dormancy secret. Threshold INTAKE_LAG_ALERT_MINUTES (30).
      provide: INTAKE_LAG_MONITOR,
      inject: [ConfigService, DrizzleIntakeLagRepo],
      useFactory: (
        config: ConfigService<Env, true>,
        repo: DrizzleIntakeLagRepo,
      ): IntakeLagMonitorService =>
        new IntakeLagMonitorService(
          repo,
          config.getOrThrow('INTAKE_LAG_ALERT_MINUTES', { infer: true }),
        ),
    },
    {
      // Driver-alert-lag guard (T12) is ALWAYS ON. Threshold
      // DRIVER_ALERT_LAG_MINUTES (15 -- tighter: a missed alert = a missed run).
      provide: ALERT_LAG_MONITOR,
      inject: [ConfigService, DrizzleAlertLagRepo],
      useFactory: (
        config: ConfigService<Env, true>,
        repo: DrizzleAlertLagRepo,
      ): AlertLagMonitorService =>
        new AlertLagMonitorService(
          repo,
          config.getOrThrow('DRIVER_ALERT_LAG_MINUTES', { infer: true }),
        ),
    },
    {
      // Intake self-healing reconciler. ALWAYS provided but tick-gated: null
      // when INTAKE_RECONCILE_ENABLED is false. Enabled is the prod default.
      provide: INTAKE_RECONCILER,
      inject: [ConfigService, DrizzleIntakeReconcileRepo],
      useFactory: (
        config: ConfigService<Env, true>,
        repo: DrizzleIntakeReconcileRepo,
      ): IntakeReconcilerService | null => {
        if (!config.getOrThrow('INTAKE_RECONCILE_ENABLED', { infer: true })) return null;
        return new IntakeReconcilerService(
          repo,
          config.getOrThrow('INTAKE_RECONCILE_AFTER_MINUTES', { infer: true }),
          config.getOrThrow('INTAKE_RECONCILE_MAX_ATTEMPTS', { infer: true }),
          config.getOrThrow('INTAKE_RECONCILE_BATCH_SIZE', { infer: true }),
        );
      },
    },
    {
      // Completion self-healing reconciler. ALWAYS provided but tick-gated: null
      // when COMPLETION_RECONCILE_ENABLED is false. Tenant-iterating.
      provide: COMPLETION_RECONCILER,
      inject: [ConfigService, DrizzleCompletionReconcileRepo],
      useFactory: (
        config: ConfigService<Env, true>,
        repo: DrizzleCompletionReconcileRepo,
      ): CompletionReconcilerService | null => {
        if (!config.getOrThrow('COMPLETION_RECONCILE_ENABLED', { infer: true })) return null;
        return new CompletionReconcilerService(
          repo,
          config.getOrThrow('COMPLETION_RECONCILE_AFTER_MINUTES', { infer: true }),
          config.getOrThrow('COMPLETION_RECONCILE_BATCH_SIZE', { infer: true }),
        );
      },
    },
    {
      // Completion-stranded proactive monitor (T16 guard). ALWAYS provided but
      // tick-gated: null when COMPLETION_MONITOR_ENABLED is false. Needs only
      // the DB (scoped repo) + Sentry.
      provide: COMPLETION_RECONCILER_MONITOR,
      inject: [ConfigService, DrizzleCompletionStrandedRepo],
      useFactory: (
        config: ConfigService<Env, true>,
        repo: DrizzleCompletionStrandedRepo,
      ): CompletionReconcilerMonitorService | null => {
        if (!config.getOrThrow('COMPLETION_MONITOR_ENABLED', { infer: true })) return null;
        return new CompletionReconcilerMonitorService(
          repo,
          config.getOrThrow('COMPLETION_STRANDED_ALERT_MINUTES', { infer: true }),
        );
      },
    },
    {
      provide: BREAKGLASS_MONITOR,
      inject: [ConfigService, KeycloakEventPollCursorService],
      useFactory: (
        config: ConfigService<Env, true>,
        cursor: KeycloakEventPollCursorService,
      ): BreakGlassLoginMonitorService | null => {
        const clientSecret = config.get('KEYCLOAK_MONITOR_CLIENT_SECRET', { infer: true });
        if (clientSecret === undefined) return null;
        const client = new KeycloakEventsClient({
          baseUrl: config.getOrThrow('KEYCLOAK_BASE_URL', { infer: true }),
          realm: 'master',
          clientId: config.getOrThrow('KEYCLOAK_MONITOR_CLIENT_ID', { infer: true }),
          clientSecret,
        });
        return new BreakGlassLoginMonitorService(
          client,
          cursor,
          config.getOrThrow('BREAKGLASS_USERNAME_PREFIX', { infer: true }),
        );
      },
    },
    {
      // SSOT assembly of the scheduler tick registry. The core three always
      // run; each optional monitor becomes a ticker iff its factory resolved
      // non-null. A NEW monitor adds a provider above and one push() here --
      // and touches ZERO lines in scheduler.service.ts (the whole point).
      provide: SCHEDULER_TICKERS,
      inject: [
        ConfigService,
        OutboxRelayService,
        ProjectionRunnerService,
        CommandsGateway,
        INTAKE_LAG_MONITOR,
        ALERT_LAG_MONITOR,
        INTAKE_RECONCILER,
        COMPLETION_RECONCILER,
        COMPLETION_RECONCILER_MONITOR,
        BREAKGLASS_MONITOR,
      ],
      useFactory: (
        config: ConfigService<Env, true>,
        outboxRelay: OutboxRelayService,
        projectionRunner: ProjectionRunnerService,
        commandsGateway: CommandsGateway,
        intakeLagMonitor: IntakeLagMonitorService | null,
        alertLagMonitor: AlertLagMonitorService | null,
        intakeReconciler: IntakeReconcilerService | null,
        completionReconciler: CompletionReconcilerService | null,
        completionMonitor: CompletionReconcilerMonitorService | null,
        breakGlassMonitor: BreakGlassLoginMonitorService | null,
      ): SchedulerTicker[] => {
        const pilotScope = config.getOrThrow('FLEET_PILOT_SCOPE', { infer: true });
        const tickers: SchedulerTicker[] = [
          {
            key: 'outbox',
            tag: 'outbox-drain',
            label: 'Outbox drain failed: ',
            intervalMs: DRAIN_INTERVAL_MS,
            run: () => outboxRelay.drainOnce(),
          },
          {
            key: 'projection',
            tag: 'projection-drain',
            label: 'Projection drain failed: ',
            intervalMs: DRAIN_INTERVAL_MS,
            run: () => projectionRunner.drainOnce(pilotScope),
          },
          {
            key: 'reconciler',
            tag: 'commands-reconciler',
            label: 'Reconciler tick failed: ',
            intervalMs: RECONCILE_INTERVAL_MS,
            run: () => {
              commandsGateway.reconcileNow();
            },
          },
        ];
        if (intakeLagMonitor !== null)
          tickers.push({
            key: 'intakeLag',
            tag: 'intake-lag-check',
            label: 'Intake-lag check failed: ',
            intervalMs: INTAKE_LAG_INTERVAL_MS,
            run: () => intakeLagMonitor.checkOnce(),
          });
        if (alertLagMonitor !== null)
          tickers.push({
            key: 'alertLag',
            tag: 'driver-alert-lag-check',
            label: 'Driver-alert-lag check failed: ',
            intervalMs: ALERT_LAG_INTERVAL_MS,
            run: () => alertLagMonitor.checkOnce(),
          });
        if (intakeReconciler !== null)
          tickers.push({
            key: 'intakeReconcile',
            tag: 'intake-reconcile',
            label: 'Intake reconcile failed: ',
            intervalMs: INTAKE_RECONCILE_INTERVAL_MS,
            run: () => intakeReconciler.reconcileOnce(),
          });
        if (completionReconciler !== null)
          tickers.push({
            key: 'completionReconcile',
            tag: 'completion-reconcile',
            label: 'Completion reconcile failed: ',
            intervalMs: COMPLETION_RECONCILE_INTERVAL_MS,
            run: () => completionReconciler.reconcileOnce(),
          });
        if (completionMonitor !== null)
          tickers.push({
            key: 'completionMonitor',
            tag: 'completion-monitor-check',
            label: 'Completion monitor check failed: ',
            intervalMs: COMPLETION_MONITOR_INTERVAL_MS,
            run: () => completionMonitor.checkOnce(),
          });
        if (breakGlassMonitor !== null)
          tickers.push({
            key: 'breakglass',
            tag: 'breakglass-scan',
            label: 'Break-glass poll failed: ',
            intervalMs: BREAKGLASS_INTERVAL_MS,
            run: () => breakGlassMonitor.pollOnce(),
          });
        return tickers;
      },
    },
  ],
})
export class SchedulerModule {}
