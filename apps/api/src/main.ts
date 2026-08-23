import { initSentry } from './observability/sentry-bootstrap.js';
// apps/api/src/main.ts
// OTel SDK is started by ./observability/otel-bootstrap.ts via 'node --import'.
import { NestFactory } from '@nestjs/core';
import { NativeLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { shutdownOtel } from './observability/otel.js';
import { assertSingleInstance } from './runtime/single-instance-guard.js';
import { selectMigrationConnectionString } from './database/migration-connection.js';
import { validateEnv } from './config/env.config.js';

assertSingleInstance(process.env);
initSentry();

async function maybeMigrate(): Promise<void> {
  if (process.env['DB_AUTO_MIGRATE'] !== 'true') return;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { Pool } = await import('pg');
  // Migrations require DDL (CREATE/ALTER); use the elevated migration credential when
  // provided (MIGRATION_DATABASE_URL), else fall back to DATABASE_URL. The helper
  // throws if neither is set, preserving the previous DB_AUTO_MIGRATE guard.
  const url = selectMigrationConnectionString(process.env);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './dist/database/migrations' });
  } finally {
    await pool.end();
  }
}

async function maybeSeed(): Promise<void> {
  if (process.env['DB_AUTO_MIGRATE'] !== 'true') return;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  const schema = await import('./database/schema/index.js');
  const { seedReference } = await import('./database/seeds/reference-seed.js');
  // Seeding writes reference rows at boot alongside migrate; use the same elevated
  // migration credential. Seeding stays best-effort: if no connection string is
  // configured at all, skip rather than fail boot.
  let url: string;
  try {
    url = selectMigrationConnectionString(process.env);
  } catch {
    return;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    // 2026 best practice: environment-gate test fixtures. The login-capable
    // test driver must never seed into production. Railway sets
    // RAILWAY_ENVIRONMENT_NAME=production; dev/test/CI leave it unset.
    const isProduction = process.env['RAILWAY_ENVIRONMENT_NAME'] === 'production'
      || process.env['NODE_ENV'] === 'production';
    await seedReference(drizzle(pool, { schema, casing: 'snake_case' }), { isProduction });
  } finally {
    await pool.end();
  }
}
async function bootstrap(): Promise<void> {
  await maybeMigrate();
  await maybeSeed();
  // Factor III: read deploy-varying config from the single validated
  // boundary (validateEnv), never raw process.env in the request path.
  const env = validateEnv(process.env);
  // bufferLogs holds messages emitted between create() and useLogger() and
  // replays them through pino, so "Nest application starting" and every
  // module's own boot line arrive as structured JSON rather than as
  // unstructured strings from the default ConsoleLogger.
  //
  // It does NOT cover a failure to BUILD the container. If module resolution
  // throws, app.get() never runs, and Nest deliberately falls back to
  // ConsoleLogger to print the error -- documented behaviour and the right
  // one, since an unstructured error still reaches stdout beats a structured
  // one that never gets a logger. Boot-failure lines are therefore the single
  // category that stays unqueryable, on purpose.
  //
  // rawBody stays: the EAS webhook verifies an HMAC over the exact bytes, so
  // it must survive alongside the logging change.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  // NativeLogger, not Logger: preserves NestJS argument semantics, so the
  // thirteen existing `new Logger(Ctx.name)` call sites emit exactly what they
  // did before. This migration changes the SINK, not any call site.
  app.useLogger(app.get(NativeLogger));
  configureApp(app, env);
  const port = env.PORT;
  await app.listen(port);

  // Factor IX (Disposability): bounded shutdown. A permanently stuck
  // app.close() (e.g. a hung DB/queue handle) must never block the
  // platform from replacing this process, so the graceful path races a
  // deadline; on timeout we exit non-zero and let the platform reap us.
  const SHUTDOWN_DEADLINE_MS = Number(process.env['SHUTDOWN_DEADLINE_MS'] ?? 10000);
  const shutdown = async (signal: string): Promise<void> => {
    const deadline = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => { reject(new Error('shutdown exceeded ' + String(SHUTDOWN_DEADLINE_MS) + 'ms after ' + signal)); },
        SHUTDOWN_DEADLINE_MS,
      );
      if (typeof t.unref === 'function') t.unref();
    });
    try {
      await Promise.race([
        (async () => {
          await app.close();
          await shutdownOtel();
        })(),
        deadline,
      ]);
      process.exit(0);
    } catch (err) {
      console.error('Shutdown failed after ' + signal, err);
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

void bootstrap();
