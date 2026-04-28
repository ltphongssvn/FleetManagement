// apps/ops-web/test/load-board.test.ts
import { describe, it, expect } from 'vitest';
import { loadDispatchBoard } from '../src/features/dispatch/load-board.js';

describe('@fleet/ops-web - loadDispatchBoard', () => {
  it('returns at least one road run for pilot data', async () => {
    const runs = await loadDispatchBoard();
    expect(runs.length).toBeGreaterThan(0);
  });

  it('every run has roadRunId and a valid state', async () => {
    const runs = await loadDispatchBoard();
    for (const r of runs) {
      expect(r.roadRunId).toMatch(/^[0-9a-f-]{36}$/);
      expect(['planned', 'dispatched', 'started', 'completed', 'cancelled']).toContain(r.state);
    }
  });

  it('returns frozen, readonly data', async () => {
    const runs = await loadDispatchBoard();
    expect(Object.isFrozen(runs)).toBe(true);
    if (runs[0]) expect(Object.isFrozen(runs[0])).toBe(true);
  });
});
