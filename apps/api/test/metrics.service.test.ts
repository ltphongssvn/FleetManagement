// apps/api/test/metrics.service.test.ts
// Unit tests for MetricsService — kill Stryker mutants with mocked drizzle chain.
// Strict TDD retrofit: written BEFORE re-running Stryker; each test pinpoints a survived/NoCoverage mutant.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsService } from '../src/metrics/metrics.service.js';

// Patch drizzle-orm so eq/sql produce inspectable marker objects.
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ _kind: 'eq', col, value }),
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => ({
    _kind: 'sql',
    raw: strings.join('?'),
  }),
}));

vi.mock('../src/database/schema/index.js', () => ({
  outbox: { status: 'outbox.status' },
}));

interface SelectCall {
  shape: Record<string, unknown>;
}
interface WhereCall {
  predicate: unknown;
}
interface FakeDb {
  selectCalls: SelectCall[];
  whereCalls: WhereCall[];
  db: object;
}
function makeFakeDb(rowsToReturn: { count: string | null | undefined }[]): FakeDb {
  const selectCalls: SelectCall[] = [];
  const whereCalls: WhereCall[] = [];
  const db = {
    select: (shape: Record<string, unknown>) => {
      selectCalls.push({ shape });
      return {
        from: (_table: unknown) => ({
          where: (predicate: unknown) => {
            whereCalls.push({ predicate });
            return Promise.resolve(rowsToReturn);
          },
        }),
      };
    },
  };
  return { selectCalls, whereCalls, db: db as object };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('@fleet/api - MetricsService.snapshot (unit)', () => {
  it('returns depth=0, no alert, and ISO timestamp when outbox empty (no rows)', async () => {
    const { db } = makeFakeDb([]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(0);
    expect(m.alerts).toEqual([]);
    expect(m.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('parses count from rows[0].count when present (kills OptionalChaining + nullish-coalesce mutants)', async () => {
    const { db } = makeFakeDb([{ count: '7' }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(7);
  });

  it('falls back to 0 when rows[0].count is null (kills StringLiteral "0" mutant on nullish-coalesce)', async () => {
    const { db } = makeFakeDb([{ count: null }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(0);
  });

  it('falls back to 0 when rows[0].count is undefined', async () => {
    const { db } = makeFakeDb([{ count: undefined }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(0);
  });

  it('does NOT raise outbox_dlq_high at depth=9 (boundary - kills >= -> > mutant)', async () => {
    const { db } = makeFakeDb([{ count: '9' }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(9);
    expect(m.alerts).toEqual([]);
  });

  it('raises outbox_dlq_high exactly at depth=10 (boundary - kills >= -> > and >= -> < mutants)', async () => {
    const { db } = makeFakeDb([{ count: '10' }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(10);
    expect(m.alerts).toEqual(['outbox_dlq_high']);
  });

  it('raises outbox_dlq_high above threshold (depth=42)', async () => {
    const { db } = makeFakeDb([{ count: '42' }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.outboxDeadLetterDepth).toBe(42);
    expect(m.alerts).toContain('outbox_dlq_high');
  });

  it('alerts array starts empty (kills ArrayDeclaration ["Stryker was here"] mutant)', async () => {
    const { db } = makeFakeDb([{ count: '0' }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.alerts).toEqual([]);
    expect(m.alerts.length).toBe(0);
  });

  it('alert string is exactly "outbox_dlq_high" (kills StringLiteral "" mutant on alerts.push)', async () => {
    const { db } = makeFakeDb([{ count: '15' }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m.alerts).toContain('outbox_dlq_high');
    expect(m.alerts[0]).toBe('outbox_dlq_high');
  });

  it('selects with a count column shape (kills .select({}) ObjectLiteral mutant)', async () => {
    const fake = makeFakeDb([{ count: '3' }]);
    const svc = new MetricsService(fake.db as never);
    await svc.snapshot();
    expect(fake.selectCalls).toHaveLength(1);
    const firstSelect = fake.selectCalls[0];
    if (!firstSelect) throw new Error('expected one select call');
    expect(Object.keys(firstSelect.shape)).toContain('count');
  });

  it('filters by outbox.status == "dead_letter" (kills eq StringLiteral "" mutant)', async () => {
    const fake = makeFakeDb([{ count: '1' }]);
    const svc = new MetricsService(fake.db as never);
    await svc.snapshot();
    expect(fake.whereCalls).toHaveLength(1);
    const firstWhere = fake.whereCalls[0];
    if (!firstWhere) throw new Error('expected one where call');
    expect(firstWhere.predicate).toMatchObject({
      _kind: 'eq',
      col: 'outbox.status',
      value: 'dead_letter',
    });
  });

  it('returns all three documented fields (kills ObjectLiteral return {} mutant)', async () => {
    const { db } = makeFakeDb([{ count: '5' }]);
    const svc = new MetricsService(db as never);
    const m = await svc.snapshot();
    expect(m).toHaveProperty('outboxDeadLetterDepth');
    expect(m).toHaveProperty('alerts');
    expect(m).toHaveProperty('capturedAt');
  });

  it('capturedAt is a fresh ISO timestamp on each call (kills capturedAt field-drop)', async () => {
    const { db } = makeFakeDb([{ count: '0' }]);
    const svc = new MetricsService(db as never);
    const m1 = await svc.snapshot();
    await new Promise((r) => setTimeout(r, 5));
    const m2 = await svc.snapshot();
    expect(new Date(m2.capturedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(m1.capturedAt).getTime(),
    );
  });
});
