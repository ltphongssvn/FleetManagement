import { initSentry } from './observability/sentry-bootstrap.js';
// apps/api/src/main.ts
// OTel SDK is started by ./observability/otel-bootstrap.ts via `node --import`.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';
import { shutdownOtel } from './observability/otel.js';
import { assertSingleInstance } from './runtime/single-instance-guard.js';

assertSingleInstance(process.env);
initSentry();

async function maybeMigrate(): Promise<void> {
  if (process.env['DB_AUTO_MIGRATE'] !== 'true') return;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { Pool } = await import('pg');
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DB_AUTO_MIGRATE=true but DATABASE_URL is unset');
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
  const url = process.env['DATABASE_URL'];
  if (!url) return;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await seedReference(drizzle(pool, { schema, casing: 'snake_case' }));
  } finally {
    await pool.end();
  }
}
async function bootstrap(): Promise<void> {
  await maybeMigrate();
  await maybeSeed();
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (process.env['CORS_ORIGINS'] ?? 'http://localhost:8081,http://localhost:3001').split(','),
    credentials: true,
  });
  app.useGlobalFilters(new ZodExceptionFilter());
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
