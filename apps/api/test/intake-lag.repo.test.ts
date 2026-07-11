// apps/api/test/intake-lag.repo.test.ts
// L1 TDD for the intake-lag monitor read port (slice G). Verifies the
// Drizzle adapter contract with a typed FleetDb mock (same harness as
// keycloak-event-poll-cursor.service.test.ts): (1) null when nothing is
// verifying (and the count query is never issued); (2) oldest row + backlog
// count; (3) the count fallback when the tally row is absent. Two select
// chains: oldest ends at .limit(1); count is AWAITED at .where, so that
// fake resolves directly.
import { describe, it, expect, vi } from 'vitest';
import { DrizzleIntakeLagRepo } from '../src/manifest/intake-lag.repo.js';
import type { FleetDb } from '../src/database/database.module.js';

interface OldestRow { manifestId: string; createdAt: Date }
function makeDb(oldest: OldestRow[], tally: { n: number }[] | 'empty'): { db: FleetDb; selectSpy: ReturnType<typeof vi.fn> } {
  const limit = vi.fn().mockResolvedValue(oldest);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const oldestWhere = vi.fn().mockReturnValue({ orderBy });
  const oldestChain = { from: vi.fn().mockReturnValue({ where: oldestWhere }) };
  const countWhere = vi.fn().mockResolvedValue(tally === 'empty' ? [] : tally);
  const countChain = { from: vi.fn().mockReturnValue({ where: countWhere }) };
  const selectSpy = vi.fn().mockReturnValueOnce(oldestChain).mockReturnValueOnce(countChain);
  const db = { select: selectSpy } as unknown as FleetDb;
  return { db, selectSpy };
}

describe('@fleet/api - DrizzleIntakeLagRepo', () => {
  it('returns null when nothing is verifying and never issues the count query', async () => {
    const { db, selectSpy } = makeDb([], [{ n: 0 }]);
    const repo = new DrizzleIntakeLagRepo(db);
    await expect(repo.oldestVerifying()).resolves.toBeNull();
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('returns the oldest verifying manifest with the backlog count', async () => {
    const createdAt = new Date('2026-06-24T00:00:00Z');
    const { db, selectSpy } = makeDb([{ manifestId: 'm-old', createdAt }], [{ n: 66 }]);
    const repo = new DrizzleIntakeLagRepo(db);
    await expect(repo.oldestVerifying()).resolves.toEqual({
      manifestId: 'm-old',
      createdAt,
      verifyingCount: 66,
    });
    expect(selectSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to a count of 1 when the tally row is absent', async () => {
    const createdAt = new Date('2026-06-24T00:00:00Z');
    const { db } = makeDb([{ manifestId: 'm-only', createdAt }], 'empty');
    const repo = new DrizzleIntakeLagRepo(db);
    await expect(repo.oldestVerifying()).resolves.toEqual({
      manifestId: 'm-only',
      createdAt,
      verifyingCount: 1,
    });
  });
});
