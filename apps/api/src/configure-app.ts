// apps/api/src/configure-app.ts
// Boundary wiring for the Nest application, extracted from bootstrap() as a
// LEAF module so it imports only @nestjs/common + the exception filters and
// never the AppModule/ConfigModule graph -- keeping it unit-testable without
// booting config validation (unit-lane graph-isolation rule).
//
// Factor IX (Disposability): enableShutdownHooks() is what makes Nest invoke
// onModuleDestroy on SIGTERM/SIGINT. Without it the DB pool close, outbox
// relay drain, and CommandsGateway in-flight push await never run on a
// platform-initiated stop. The bounded shutdown DEADLINE stays in main.ts
// bootstrap (it owns the process + signal handlers).
//
// Factor III (Config): CORS origins arrive as the ALREADY-VALIDATED Env from
// bootstrap, never re-read from raw process.env here -- one validated
// boundary per process, no second parse path that could drift.
import type { INestApplication } from '@nestjs/common';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';
import { ProblemDetailsExceptionFilter } from './common/problem-details-exception.filter.js';
import type { Env } from './config/env.config.js';

export type AppConfig = Pick<Env, 'CORS_ORIGINS'>;

export function configureApp(app: INestApplication, config: AppConfig): void {
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
  });
  // Catch-all problem-details filter FIRST, ZodExceptionFilter LAST: Nest
  // evaluates filters in reverse registration order, so ZodError keeps its
  // existing 400 validation shape and everything else emits RFC 9457.
  app.useGlobalFilters(new ProblemDetailsExceptionFilter(), new ZodExceptionFilter());
  // Factor IX: register SIGTERM/SIGINT -> onModuleDestroy lifecycle hooks.
  app.enableShutdownHooks();
}
