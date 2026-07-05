// apps/api/test/keycloak-event-poll-cursor.service.test.ts
// L1 outside-in TDD for the break-glass poll cursor (single-row high-water mark).
// Verifies: (1) readCursor returns stored position when the singleton exists;
// (2) readCursor lazily SEEDS the singleton and returns the zero position when
// absent (first-ever poll starts from epoch 0); (3) advanceCursor updates the
// singleton with the new time + id; (4) advanceCursor is MONOTONIC — a stale
// (older-or-equal) time never rewinds the high-water mark, so a late/duplicate
// page cannot cause re-alerting. db is a typed FleetDb mock (no real DB), same
// harness as admin-drivers-reset-password.service.test.ts.
import { describe, it, expect, vi } from 'vitest';
import { KeycloakEventPollCursorService } from '../src/security/keycloak-event-poll-cursor.service.js';
import type { FleetDb } from '../src/database/database.module.js';

interface CursorRow { lastEventTimeMs: number; lastEventId: string | null }

interface DbMocks {
  selectLimit: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  updateWhere: ReturnType<typeof vi.fn>;
}

function makeDb(existing: CursorRow | null): { db: FleetDb; m: DbMocks } {
  const selectLimit = vi.fn().mockResolvedValue(existing ? [existing] : []);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: selectLimit }) }),
    }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
  } as unknown as FleetDb;
  return { db, m: { selectLimit, insertValues, updateSet, updateWhere } };
}

describe('KeycloakEventPollCursorService', () => {
  it('readCursor returns the stored position when the singleton row exists', async () => {
    const { db, m } = makeDb({ lastEventTimeMs: 1_751_000_000_000, lastEventId: 'evt-42' });
    const svc = new KeycloakEventPollCursorService(db);
    const cursor = await svc.readCursor();
    expect(cursor).toEqual({ lastEventTimeMs: 1_751_000_000_000, lastEventId: 'evt-42' });
    expect(m.insertValues).not.toHaveBeenCalled();
  });

  it('readCursor lazily seeds the singleton and returns the zero position when absent', async () => {
    const { db, m } = makeDb(null);
    const svc = new KeycloakEventPollCursorService(db);
    const cursor = await svc.readCursor();
    expect(cursor).toEqual({ lastEventTimeMs: 0, lastEventId: null });
    expect(m.insertValues).toHaveBeenCalledTimes(1);
  });

  it('advanceCursor updates the singleton with the new time and id', async () => {
    const { db, m } = makeDb({ lastEventTimeMs: 100, lastEventId: 'old' });
    const svc = new KeycloakEventPollCursorService(db);
    await svc.advanceCursor(200, 'evt-new');
    expect(m.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventTimeMs: 200, lastEventId: 'evt-new' }),
    );
    expect(m.updateWhere).toHaveBeenCalledTimes(1);
  });

  it('advanceCursor is monotonic: a stale (older-or-equal) time does NOT rewind', async () => {
    const { db, m } = makeDb({ lastEventTimeMs: 500, lastEventId: 'current' });
    const svc = new KeycloakEventPollCursorService(db);
    await svc.advanceCursor(300, 'stale');
    expect(m.updateSet).not.toHaveBeenCalled();
  });

  it('advanceCursor writes updatedAt alongside the position', async () => {
    const { db, m } = makeDb({ lastEventTimeMs: 100, lastEventId: 'old' });
    const svc = new KeycloakEventPollCursorService(db);
    await svc.advanceCursor(200, 'evt-new');
    const arg = m.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['updatedAt']).toBeInstanceOf(Date);
  });
});
