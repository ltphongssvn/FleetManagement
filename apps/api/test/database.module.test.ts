// apps/api/test/database.module.test.ts
// DI wire-up test: verify PG_POOL + DRIZZLE_DB providers are registered
// and onModuleDestroy drains the pool.
import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseModule } from '../src/database/database.module.js';
import { DRIZZLE_DB, PG_POOL } from '../src/database/database.tokens.js';
import { validateEnv } from '../src/config/env.config.js';

describe('@fleet/api - DatabaseModule', () => {
  it('registers PG_POOL and DRIZZLE_DB providers', async () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/fleet_test';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
      ],
    }).compile();

    const pool = moduleRef.get<Pool>(PG_POOL);
    const db = moduleRef.get(DRIZZLE_DB);
    expect(pool).toBeInstanceOf(Pool);
    expect(db).toBeDefined();

    // Avoid actually connecting — spy on .end and trigger lifecycle.
    const endSpy = vi.spyOn(pool, 'end').mockResolvedValue();
    await moduleRef.close();
    expect(endSpy).toHaveBeenCalledOnce();
  });
});
