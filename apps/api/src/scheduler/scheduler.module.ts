// apps/api/src/scheduler/scheduler.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ProjectionsModule } from '../projections/projections.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { SchedulerService, BREAKGLASS_MONITOR, INTAKE_LAG_MONITOR, INTAKE_RECONCILER, COMPLETION_RECONCILER_MONITOR } from './scheduler.service.js';
import { KeycloakEventPollCursorService } from '../security/keycloak-event-poll-cursor.service.js';
import { KeycloakEventsClient } from '../security/keycloak-events-client.js';
import { BreakGlassLoginMonitorService } from '../security/break-glass-login-monitor.service.js';
import { IntakeLagMonitorService } from '../manifest/intake-lag-monitor.service.js';
import { DrizzleIntakeLagRepo } from '../manifest/intake-lag.repo.js';
import { IntakeReconcilerService } from '../manifest/intake-reconciler.service.js';
import { DrizzleIntakeReconcileRepo } from '../manifest/intake-reconcile.repo.js';
import { CompletionReconcilerMonitorService } from '../maintenance/completion-reconciler-monitor.service.js';
import { DrizzleCompletionStrandedRepo, COMPLETION_STRANDED_PILOT_SCOPE } from '../maintenance/completion-stranded.repo.js';
import type { Env } from '../config/env.config.js';

// The break-glass monitor is provided lazily and is DORMANT unless
// KEYCLOAK_MONITOR_CLIENT_SECRET is set: the factory returns null when the secret
// is absent, so SchedulerService skips the break-glass tick entirely (no client,
// no poll). This mirrors the AWS_*/FLEET_API_* "port absent -> skip" gating and
// keeps local/dev without the secret from polling production Keycloak.
@Module({
  imports: [ConfigModule, OutboxModule, ProjectionsModule, CommandsModule],
  providers: [
    SchedulerService,
    KeycloakEventPollCursorService,
    DrizzleIntakeLagRepo,
    DrizzleIntakeReconcileRepo,
    {
      // The completion-stranded repo is company-scoped (the finder filters by
      // companyId); supply the pilot scope from config so the monitor reads the
      // same tenant the projection runner drains.
      provide: COMPLETION_STRANDED_PILOT_SCOPE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string =>
        config.getOrThrow('FLEET_PILOT_SCOPE', { infer: true }),
    },
    DrizzleCompletionStrandedRepo,
    {
      // Intake-lag guard (Jun-24 incident class) is ALWAYS ON: it needs only
      // the DB + Sentry (both unconditionally present), so unlike the
      // break-glass monitor there is no dormancy secret. Threshold is the
      // INTAKE_LAG_ALERT_MINUTES knob (default 30).
      provide: INTAKE_LAG_MONITOR,
      inject: [ConfigService, DrizzleIntakeLagRepo],
      useFactory: (
        config: ConfigService<Env, true>,
        repo: DrizzleIntakeLagRepo,
      ): IntakeLagMonitorService =>
        new IntakeLagMonitorService(repo, config.getOrThrow('INTAKE_LAG_ALERT_MINUTES', { infer: true })),
    },
    {
      // Intake self-healing reconciler. ALWAYS provided but tick-gated:
      // the factory returns null when INTAKE_RECONCILE_ENABLED is false,
      // so SchedulerService skips the tick entirely (mirrors the
      // break-glass dormancy pattern). Enabled is the production default.
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
      // Completion-stranded proactive monitor (T16 guard). ALWAYS provided but
      // tick-gated: the factory returns null when COMPLETION_MONITOR_ENABLED is
      // false, so SchedulerService skips the tick (mirrors the intake-reconciler
      // dormancy pattern). Loud-by-default is the production posture. Needs only
      // the DB (via the scoped repo) + Sentry, both unconditionally present.
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
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SchedulerModule {}
