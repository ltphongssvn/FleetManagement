// apps/api/test/copilot-plan-execution.store.test.ts
// L1 outside-in TDD for the copilot plan idempotency ledger. Verifies:
// (1) tryBegin atomically CLAIMS a planId via INSERT .. ON CONFLICT DO
// NOTHING .. RETURNING -- a returned row means this caller won; (2) a
// duplicate planId returns false without any update; (3) complete stamps
// status + completedAt for both terminal statuses; (4) the service
// structurally satisfies the executor's CopilotPlanExecutionStore port.
// db is a typed FleetDb mock (no real DB), same harness as
// keycloak-event-poll-cursor.service.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { FleetDb } from '../src/database/database.module.js';
import type { CopilotPlanExecutionStore } from '../src/copilot/copilot-executor.service.js';
import { CopilotPlanExecutionStoreService } from '../src/copilot/copilot-plan-execution.store.js';

const PLAN = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const COMPANY = 'f9bb7e54-eb05-4eee-ff78-a24adcba9668';

interface DbMocks {
  insertValues: ReturnType<typeof vi.fn>;
  onConflict: ReturnType<typeof vi.fn>;
  insertReturning: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  updateWhere: ReturnType<typeof vi.fn>;
}

function makeDb(claimed: boolean): { db: FleetDb; m: DbMocks } {
  const insertReturning = vi.fn().mockResolvedValue(claimed ? [{ planId: PLAN }] : []);
  const onConflict = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: onConflict });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const db = {
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
  } as unknown as FleetDb;
  return { db, m: { insertValues, onConflict, insertReturning, updateSet, updateWhere } };
}

describe('CopilotPlanExecutionStoreService', () => {
  it('tryBegin claims a fresh planId: inserts started row and returns true', async () => {
    const { db, m } = makeDb(true);
    const svc = new CopilotPlanExecutionStoreService(db);
    const won = await svc.tryBegin(PLAN, COMPANY);
    expect(won).toBe(true);
    expect(m.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ planId: PLAN, companyId: COMPANY, status: 'started' }),
    );
    expect(m.onConflict).toHaveBeenCalledTimes(1);
    expect(m.updateSet).not.toHaveBeenCalled();
  });

  it('tryBegin returns false on a duplicate planId without updating anything', async () => {
    const { db, m } = makeDb(false);
    const svc = new CopilotPlanExecutionStoreService(db);
    const won = await svc.tryBegin(PLAN, COMPANY);
    expect(won).toBe(false);
    expect(m.updateSet).not.toHaveBeenCalled();
  });

  it('complete stamps status completed with a completedAt timestamp', async () => {
    const { db, m } = makeDb(true);
    const svc = new CopilotPlanExecutionStoreService(db);
    await svc.complete(PLAN, 'completed');
    expect(m.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', completedAt: expect.any(Date) }),
    );
    expect(m.updateWhere).toHaveBeenCalledTimes(1);
  });

  it('complete stamps status failed the same way', async () => {
    const { db, m } = makeDb(true);
    const svc = new CopilotPlanExecutionStoreService(db);
    await svc.complete(PLAN, 'failed');
    expect(m.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', completedAt: expect.any(Date) }),
    );
  });

  it('structurally satisfies the executor CopilotPlanExecutionStore port', () => {
    const { db } = makeDb(true);
    const store: CopilotPlanExecutionStore = new CopilotPlanExecutionStoreService(db);
    expect(typeof store.tryBegin).toBe('function');
    expect(typeof store.complete).toBe('function');
  });
});
