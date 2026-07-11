// apps/api/src/scheduler/scheduler.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ProjectionsModule } from '../projections/projections.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { SchedulerService, BREAKGLASS_MONITOR, INTAKE_LAG_MONITOR } from './scheduler.service.js';
import { KeycloakEventPollCursorService } from '../security/keycloak-event-poll-cursor.service.js';
import { KeycloakEventsClient } from '../security/keycloak-events-client.js';
import { BreakGlassLoginMonitorService } from '../security/break-glass-login-monitor.service.js';
import { IntakeLagMonitorService } from '../manifest/intake-lag-monitor.service.js';
import { DrizzleIntakeLagRepo } from '../manifest/intake-lag.repo.js';
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
