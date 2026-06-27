// packages/sync-protocol/test/command-contract.test.ts
// RED-first (P0-#4, 2026): single-source-of-truth for the dispatch COMMAND wire
// contract. CommandTypeSchema + CommandPayloadSchema were defined IDENTICALLY in
// apps/api command.dto.ts and apps/driver-app command-receiver-policy.ts (the api
// ISSUES commands, the driver-app RECEIVES them -- one wire contract, copy-pasted).
// AckRejectionReason + CommandAck were ALSO duplicated and drifted in FORM: the api
// had a z.enum + z.discriminatedUnion (validated), the driver-app had hand-written
// TS unions (no schema, cannot validate). One definition here is the SSOT; both
// sides import it, and the driver-app gains runtime ack validation.
//
// No brands are involved (unlike the sync-types ID brands), so a shared Zod schema
// is the correct mechanism and strips nothing. z.guid() is preserved exactly (NOT
// migrated to the stricter v4 z.uuid()) to avoid tightening validation in a
// pure consolidation. Written before
// packages/sync-protocol/src/command-contract.ts exists -> fails at import
// resolution until source + barrel export land.
import { describe, it, expect } from 'vitest';
import {
  CommandTypeSchema,
  CommandPayloadSchema,
  AckRejectionReasonSchema,
  CommandAckSchema,
  type CommandType,
  type CommandPayload,
  type AckRejectionReason,
  type CommandAck,
} from '../src/command-contract.js';

const U = '11111111-aaaa-4aaa-8aaa-111111111111';
const validCommand = {
  commandId: U,
  type: 'assign_run',
  targetOperatorId: U,
  aggregateType: 'road_run',
  aggregateId: U,
  payload: { roadRunId: U },
  issuedAt: '2026-06-11T13:34:58.000Z',
};

describe('@fleet/sync-protocol - CommandTypeSchema', () => {
  it('accepts every canonical command type', () => {
    for (const t of ['assign_run', 'reassign_run', 'cancel_run', 'status_update']) {
      expect(CommandTypeSchema.parse(t)).toBe(t);
    }
  });
  it('rejects unknown command types', () => {
    expect(CommandTypeSchema.safeParse('teleport').success).toBe(false);
  });
  it('infers the literal union', () => {
    const t: CommandType = 'cancel_run';
    expect(t).toBe('cancel_run');
  });
});

describe('@fleet/sync-protocol - CommandPayloadSchema', () => {
  it('parses a valid command payload', () => {
    const parsed: CommandPayload = CommandPayloadSchema.parse(validCommand);
    expect(parsed.commandId).toBe(U);
  });
  it('rejects a non-uuid commandId', () => {
    expect(CommandPayloadSchema.safeParse({ ...validCommand, commandId: 'bad' }).success).toBe(false);
  });
  it('rejects a non-uuid targetOperatorId', () => {
    expect(CommandPayloadSchema.safeParse({ ...validCommand, targetOperatorId: 'bad' }).success).toBe(false);
  });
  it('rejects a non-datetime issuedAt', () => {
    expect(CommandPayloadSchema.safeParse({ ...validCommand, issuedAt: 'yesterday' }).success).toBe(false);
  });
});

describe('@fleet/sync-protocol - AckRejectionReasonSchema', () => {
  it('accepts every canonical rejection reason', () => {
    for (const r of ['operator_offline', 'operator_busy', 'invalid_state', 'not_authorized', 'stale_command', 'duplicate_command', 'client_error']) {
      expect(AckRejectionReasonSchema.parse(r)).toBe(r);
    }
  });
  it('rejects free-text reasons', () => {
    expect(AckRejectionReasonSchema.safeParse('something went wrong').success).toBe(false);
  });
  it('infers the literal union', () => {
    const r: AckRejectionReason = 'operator_busy';
    expect(r).toBe('operator_busy');
  });
});

describe('@fleet/sync-protocol - CommandAckSchema (discriminated union)', () => {
  const received = { commandId: U, ackedAt: '2026-06-11T13:34:58.000Z', status: 'received' };
  const rejected = { commandId: U, ackedAt: '2026-06-11T13:34:58.000Z', status: 'rejected', reasonCode: 'operator_offline' };
  it('parses a received ack', () => {
    const a: CommandAck = CommandAckSchema.parse(received);
    expect(a.status).toBe('received');
  });
  it('parses a rejected ack with a reason code', () => {
    expect(CommandAckSchema.parse(rejected).status).toBe('rejected');
  });
  it('accepts an optional reasonText on a rejected ack', () => {
    expect(CommandAckSchema.parse({ ...rejected, reasonText: 'offline 5m' }).status).toBe('rejected');
  });
  it('rejects a rejected ack missing its reasonCode', () => {
    const { reasonCode: _omit, ...bad } = rejected;
    expect(CommandAckSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects an unknown status discriminant', () => {
    expect(CommandAckSchema.safeParse({ ...received, status: 'maybe' }).success).toBe(false);
  });
});
