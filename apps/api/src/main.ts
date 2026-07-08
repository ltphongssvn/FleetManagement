import { initSentry } from './observability/sentry-bootstrap.js';
// apps/api/src/main.ts
// OTel SDK is started by ./observability/otel-bootstrap.ts via 'node --import'.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';
import { ProblemDetailsExceptionFilter } from './common/problem-details-exception.filter.js';
import { shutdownOtel } from './observability/otel.js';
import { assertSingleInstance } from './runtime/single-instance-guard.js';
import { selectMigrationConnectionString } from './database/migration-connection.js';

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
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: (process.env['CORS_ORIGINS'] ?? 'http://localhost:8081,http://localhost:3001').split(','),
    credentials: true,
  });
  // Catch-all problem-details filter FIRST, ZodExceptionFilter LAST: Nest
  // evaluates filters in reverse registration order, so ZodError keeps its
  // existing 400 validation shape and everything else emits RFC 9457.
  app.useGlobalFilters(new ProblemDetailsExceptionFilter(), new ZodExceptionFilter());
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);

  const shutdown = async (signal: string): Promise<void> => {
    try {
      await app.close();
      await shutdownOtel();
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
