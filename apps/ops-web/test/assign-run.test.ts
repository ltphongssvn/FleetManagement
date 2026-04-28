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
});
