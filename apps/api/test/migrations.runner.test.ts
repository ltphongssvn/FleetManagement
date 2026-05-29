// apps/api/test/migrations.runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runMigrationsIfEnabled } from '../src/database/migrations-runner.js';

describe('@fleet/api - runMigrationsIfEnabled', () => {
  it('runs migrate when DB_AUTO_MIGRATE=true', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined);
    const result = await runMigrationsIfEnabled({ env: { DB_AUTO_MIGRATE: 'true' }, migrate });
    expect(result.executed).toBe(true);
    expect(migrate).toHaveBeenCalledOnce();
  });
  it('skips when DB_AUTO_MIGRATE not true', async () => {
    const migrate = vi.fn();
    const result = await runMigrationsIfEnabled({ env: {}, migrate });
    expect(result.executed).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
  });
});
