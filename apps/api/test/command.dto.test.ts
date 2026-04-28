// apps/api/test/command.dto.test.ts
import { describe, it, expect } from 'vitest';
import { CommandPayloadSchema, CommandAckSchema, CommandTypeSchema, AckRejectionReasonSchema } from '../src/commands/command.dto.js';

const validCommand = {
  commandId: '00000000-0000-0000-0000-000000000001',
  type: 'assign_run' as const,
  targetOperatorId: '00000000-0000-0000-0000-000000000002',
  aggregateType: 'road_run',
  aggregateId: '00000000-0000-0000-0000-000000000003',
  payload: { roadRunId: 'rr-1' },
  issuedAt: '2026-04-27T19:00:00.000Z',
};

describe('@fleet/api - CommandTypeSchema', () => {
  it('accepts all 4 PDF-mandated command types', () => {
    for (const t of ['assign_run', 'reassign_run', 'cancel_run', 'status_update']) {
      expect(CommandTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects unknown command type', () => {
    expect(CommandTypeSchema.safeParse('teleport').success).toBe(false);
  });
});

describe('@fleet/api - CommandPayloadSchema', () => {
  it('accepts valid command', () => {
    expect(CommandPayloadSchema.parse(validCommand)).toEqual(validCommand);
  });

  it('rejects non-uuid commandId', () => {
    expect(CommandPayloadSchema.safeParse({ ...validCommand, commandId: 'bad' }).success).toBe(false);
  });

  it('rejects non-uuid targetOperatorId', () => {
    expect(CommandPayloadSchema.safeParse({ ...validCommand, targetOperatorId: 'bad' }).success).toBe(false);
  });

  it('rejects non-ISO issuedAt', () => {
    expect(CommandPayloadSchema.safeParse({ ...validCommand, issuedAt: 'yesterday' }).success).toBe(false);
  });
});

describe('@fleet/api - AckRejectionReasonSchema', () => {
  it('accepts all enum values', () => {
    for (const r of ['operator_offline', 'operator_busy', 'invalid_state', 'not_authorized', 'stale_command', 'duplicate_command', 'client_error']) {
      expect(AckRejectionReasonSchema.parse(r)).toBe(r);
    }
  });

  it('rejects free-text reason', () => {
    expect(AckRejectionReasonSchema.safeParse('something went wrong').success).toBe(false);
  });
});

describe('@fleet/api - CommandAckSchema (discriminated union)', () => {
  const validReceived = {
    commandId: '00000000-0000-0000-0000-000000000001',
    ackedAt: '2026-04-27T19:00:01.000Z',
    status: 'received' as const,
  };
  const validRejected = {
    commandId: '00000000-0000-0000-0000-000000000001',
    ackedAt: '2026-04-27T19:00:01.000Z',
    status: 'rejected' as const,
    reasonCode: 'invalid_state' as const,
  };

  it('accepts received ack', () => {
    expect(CommandAckSchema.parse(validReceived)).toEqual(validReceived);
  });

  it('accepts rejected ack with reasonCode', () => {
    const r = CommandAckSchema.parse(validRejected);
    expect(r.status).toBe('rejected');
  });

  it('accepts rejected ack with optional reasonText', () => {
    const withText = { ...validRejected, reasonText: 'operator declined' };
    expect(CommandAckSchema.parse(withText).status).toBe('rejected');
  });

  it('rejects rejected ack without reasonCode', () => {
    const { reasonCode: _omit, ...without } = validRejected;
    expect(CommandAckSchema.safeParse(without).success).toBe(false);
  });

  it('rejects unknown status value', () => {
    expect(CommandAckSchema.safeParse({ ...validReceived, status: 'maybe' }).success).toBe(false);
  });
});
