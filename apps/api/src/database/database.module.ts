// apps/api/src/database/database.module.ts
// Provides a singleton pg.Pool + Drizzle wrapper. Pool is a separate provider
// so it can be injected for cleanup, health checks, and tests.
import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';
import { DRIZZLE_DB, PG_POOL } from './database.tokens.js';
import type { Env } from '../config/env.config.js';

export type FleetDb = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Pool =>
        new Pool({
          connectionString: config.getOrThrow('DATABASE_URL', { infer: true }),
          max: config.getOrThrow('DB_POOL_MAX', { infer: true }),
          idleTimeoutMillis: config.getOrThrow('DB_IDLE_TIMEOUT_MS', { infer: true }),
        }),
    },
    {
      provide: DRIZZLE_DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): FleetDb => drizzle(pool, { schema, casing: 'snake_case' }),
    },
  ],
  exports: [DRIZZLE_DB, PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing database connection pool...');
    await this.pool.end();
    this.logger.log('Database connection pool closed.');
  }
}
