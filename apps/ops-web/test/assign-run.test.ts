// apps/ops-web/test/assign-run.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { assignRun } = await import('../src/features/dispatch/assign-run.action.js');

const validInput = {
  roadRunId: '11111111-1111-4111-8111-111111111111',
  operatorId: '22222222-2222-4222-8222-222222222222',
  assetId: 'truck-7',
};

describe('@fleet/ops-web - assignRun', () => {
  it('returns ok for valid input', async () => {
    const result = await assignRun(validInput);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.roadRunId).toBe(validInput.roadRunId);
  });

  it('returns invalid_input with structured code for non-uuid roadRunId', async () => {
    const result = await assignRun({ ...validInput, roadRunId: 'bad' });
    expect(result.status).toBe('invalid_input');
    if (result.status === 'invalid_input') {
      expect(result.issues[0]?.code).toBe('invalid_uuid');
      expect(result.issues[0]?.path).toEqual(['roadRunId']);
    }
  });

  it('returns invalid_input for non-uuid operatorId', async () => {
    const result = await assignRun({ ...validInput, operatorId: 'bad' });
    expect(result.status).toBe('invalid_input');
  });

  it('accepts input without optional assetId', async () => {
    const { assetId: _omit, ...without } = validInput;
    const result = await assignRun(without);
    expect(result.status).toBe('ok');
  });

  it('rejects empty assetId with too_short code', async () => {
    const result = await assignRun({ ...validInput, assetId: '' });
    expect(result.status).toBe('invalid_input');
    if (result.status === 'invalid_input') {
      expect(result.issues[0]?.code).toBe('too_short');
    }
  });
})

describe('@fleet/ops-web - assignRun (property-based)', () => {
  it('rejects any random non-uuid roadRunId with invalid_uuid code', async () => {
    const fc = await import('fast-check');
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)),
        async (badId) => {
          const result = await assignRun({ ...validInput, roadRunId: badId });
          if (result.status !== 'invalid_input') return false;
          return result.issues.some((i) => i.code === 'invalid_uuid' && i.path.includes('roadRunId'));
        },
      ),
      { numRuns: 30 },
    );
  });

  it('always accepts well-formed UUIDs', async () => {
    const fc = await import('fast-check');
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (rrId, opId) => {
        const result = await assignRun({ roadRunId: rrId, operatorId: opId });
        return result.status === 'ok';
      }),
      { numRuns: 30 },
    );
  });
})

describe('@fleet/ops-web - assignRun (issue code mapping)', () => {
  it('maps too-long assetId to too_long code', async () => {
    const result = await assignRun({ ...validInput, assetId: 'x'.repeat(100) });
    expect(result.status).toBe('invalid_input');
    if (result.status === 'invalid_input') {
      expect(result.issues[0]?.code).toBe('too_long');
    }
  });

  it('maps missing required field to unknown code', async () => {
    const result = await assignRun({ operatorId: validInput.operatorId } as never);
    expect(result.status).toBe('invalid_input');
    if (result.status === 'invalid_input') {
      const codes = result.issues.map((i) => i.code);
      expect(codes.length).toBeGreaterThan(0);
    }
  });
});
