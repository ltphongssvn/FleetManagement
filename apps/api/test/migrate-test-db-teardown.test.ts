// apps/api/test/migrate-test-db-teardown.test.ts
// outside-in strict TDD RED (L1): when a beforeAll hook times out (heavy CI
// load), testDb is never assigned, so afterAll calls stopMigratedTestDb(undefined).
// Empirically observed: 'TypeError: Cannot read properties of undefined (reading
// pool)' crashed the whole vitest run, masking the real timeout. Teardown must be
// null-safe so a single slow container start surfaces ONE clear timeout, not a
// cascading secondary crash that fails unrelated files.
import { describe, it, expect } from 'vitest';
import { stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
describe('stopMigratedTestDb null-safety', () => {
  it('resolves without throwing when given undefined (failed beforeAll)', async () => {
    await expect(
      stopMigratedTestDb(undefined as unknown as MigratedTestDb),
    ).resolves.toBeUndefined();
  });
  it('resolves without throwing when given a partial object missing pool', async () => {
    await expect(stopMigratedTestDb({} as unknown as MigratedTestDb)).resolves.toBeUndefined();
  });
});
