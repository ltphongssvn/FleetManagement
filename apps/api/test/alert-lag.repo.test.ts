// apps/api/test/alert-lag.repo.test.ts
// S6b (T12 driver-order-alerts) -- L1 TDD for the alert-lag monitor read port.
// Verifies the Drizzle adapter contract with a typed FleetDb mock (same harness
// as intake-lag.repo.test.ts / keycloak-event-poll-cursor). The repo produces
// an AlertLagSnapshot from the outbox filtered to aggregateType=driver_alert:
//   1) deadLetterCount  -- status=dead_letter rows (permanent misses)
//   2) oldest pending/failed row (status IN pending,failed) + pendingCount
// null is returned only when the outbox has NO driver_alert rows at all
// (nothing to watch); an all-sent history yields a zeroed snapshot, not null,
// so a later stall is still detected against a live baseline.
import { describe, it, expect, vi } from 'vitest';
import { DrizzleAlertLagRepo } from '../src/manifest/alert-lag.repo.js';
import type { FleetDb } from '../src/database/database.module.js';

interface OldestRow { outboxId: string; createdAt: Date }

// The repo issues three select chains in order:
//   (a) dead-letter count  -> awaited at .where
//   (b) oldest pending     -> .orderBy(...).limit(1)
//   (c) pending count      -> awaited at .where
function makeDb(
  deadTally: { n: number }[],
  oldest: OldestRow[],
  pendingTally: { n: number }[],
): { db: FleetDb; selectSpy: ReturnType<typeof vi.fn> } {
  const deadWhere = vi.fn().mockResolvedValue(deadTally);
  const deadChain = { from: vi.fn().mockReturnValue({ where: deadWhere }) };
  const limit = vi.fn().mockResolvedValue(oldest);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const oldestWhere = vi.fn().mockReturnValue({ orderBy });
  const oldestChain = { from: vi.fn().mockReturnValue({ where: oldestWhere }) };
  const pendingWhere = vi.fn().mockResolvedValue(pendingTally);
  const pendingChain = { from: vi.fn().mockReturnValue({ where: pendingWhere }) };
  const selectSpy = vi
    .fn()
    .mockReturnValueOnce(deadChain)
    .mockReturnValueOnce(oldestChain)
    .mockReturnValueOnce(pendingChain);
  const db = { select: selectSpy } as unknown as FleetDb;
  return { db, selectSpy };
}

describe('@fleet/api - DrizzleAlertLagRepo', () => {
  it('reports dead-letters with a null oldest-pending when none are pending', async () => {
    const { db } = makeDb([{ n: 2 }], [], [{ n: 0 }]);
    const repo = new DrizzleAlertLagRepo(db);
    await expect(repo.snapshot()).resolves.toEqual({
      deadLetterCount: 2,
      oldestPendingId: null,
      oldestPendingCreatedAt: null,
      pendingCount: 0,
    });
  });

  it('reports the oldest pending alert with its backlog count', async () => {
    const createdAt = new Date('2026-07-20T03:40:00Z');
    const { db } = makeDb([{ n: 0 }], [{ outboxId: 'ob-old', createdAt }], [{ n: 5 }]);
    const repo = new DrizzleAlertLagRepo(db);
    await expect(repo.snapshot()).resolves.toEqual({
      deadLetterCount: 0,
      oldestPendingId: 'ob-old',
      oldestPendingCreatedAt: createdAt,
      pendingCount: 5,
    });
  });

  it('returns a zeroed snapshot (not null) when all driver_alert rows are sent', async () => {
    const { db } = makeDb([{ n: 0 }], [], [{ n: 0 }]);
    const repo = new DrizzleAlertLagRepo(db);
    await expect(repo.snapshot()).resolves.toEqual({
      deadLetterCount: 0,
      oldestPendingId: null,
      oldestPendingCreatedAt: null,
      pendingCount: 0,
    });
  });

  it('falls back to a pending count of 1 when the tally row is absent', async () => {
    const createdAt = new Date('2026-07-20T03:00:00Z');
    const { db } = makeDb([{ n: 0 }], [{ outboxId: 'ob-1', createdAt }], []);
    const repo = new DrizzleAlertLagRepo(db);
    const snap = await repo.snapshot();
    expect(snap?.pendingCount).toBe(1);
    expect(snap?.oldestPendingId).toBe('ob-1');
  });

  it('falls back to a dead-letter count of 0 when that tally row is absent', async () => {
    const { db } = makeDb([], [], [{ n: 0 }]);
    const repo = new DrizzleAlertLagRepo(db);
    const snap = await repo.snapshot();
    expect(snap?.deadLetterCount).toBe(0);
  });
});
