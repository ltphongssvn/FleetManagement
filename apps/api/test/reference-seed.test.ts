// apps/api/test/reference-seed.test.ts
// RED-first: seed must create at least one login-capable driver
// (non-null phone + bcrypt-verifiable passwordHash) so the deployed
// API's real JWT /auth/login flow can authenticate the mobile app.
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { seedReference } from '../src/database/seeds/reference-seed.js';
import type { FleetDb } from '../src/database/database.module.js';

interface CapturedInsert {
  readonly table: string;
  readonly values: Record<string, unknown>;
}

function makeFakeDb(captured: CapturedInsert[]): FleetDb {
  const tableNameOf = (t: unknown): string => {
    const sym = Object.getOwnPropertySymbols(t as object).find(
      (s) => s.description === 'drizzle:Name',
    );
    return sym ? String((t as Record<symbol, unknown>)[sym]) : 'unknown';
  };
  return {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          captured.push({ table: tableNameOf(table), values });
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as FleetDb;
}

describe('seedReference - login-capable driver', () => {
  it('seeds at least one driver with a non-null phone', async () => {
    const captured: CapturedInsert[] = [];
    await seedReference(makeFakeDb(captured));
    const drivers = captured.filter((c) => c.table === 'driver');
    const withPhone = drivers.filter(
      (d) => typeof d.values['phone'] === 'string' && d.values['phone'] !== '',
    );
    expect(withPhone.length).toBeGreaterThan(0);
  });

  it('seeds a driver whose passwordHash verifies against a known password', async () => {
    const captured: CapturedInsert[] = [];
    await seedReference(makeFakeDb(captured));
    const seeded = captured
      .filter((c) => c.table === 'driver')
      .find((d) => d.values['phone'] === '0900000001');
    expect(seeded).toBeDefined();
    const hash = seeded?.values['passwordHash'];
    expect(typeof hash).toBe('string');
    const ok = await bcrypt.compare('driver1pass', hash as string);
    expect(ok).toBe(true);
  });

  it('binds the seeded login driver to an operatorId', async () => {
    const captured: CapturedInsert[] = [];
    await seedReference(makeFakeDb(captured));
    const seeded = captured
      .filter((c) => c.table === 'driver')
      .find((d) => d.values['phone'] === '0900000001');
    expect(seeded?.values['operatorId']).toBeTypeOf('string');
  });
});
