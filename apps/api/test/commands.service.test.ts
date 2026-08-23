// apps/api/test/commands.service.test.ts
// Unit tests for CommandsService.persist — kill Stryker mutants by mocking
// the transaction + appendTriWrite + allocateServerSeq seam.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAppendTriWrite, mockAllocateServerSeq } = vi.hoisted(() => ({
  mockAppendTriWrite: vi.fn(),
  mockAllocateServerSeq: vi.fn(),
}));

vi.mock('../src/database/append-tri-write.js', () => ({
  appendTriWrite: mockAppendTriWrite,
}));
vi.mock('../src/database/server-seq.repository.js', () => ({
  allocateServerSeq: mockAllocateServerSeq,
}));

import { CommandsService } from '../src/commands/commands.service.js';
import type { CommandPayload } from '../src/commands/command.dto.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

interface FakeTx {
  __tx: true;
}
const FAKE_TX: FakeTx = { __tx: true };

function makeDb(): { db: object; transactionCalls: number } {
  let transactionCalls = 0;
  const db = {
    transaction: async <T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> => {
      transactionCalls++;
      return fn(FAKE_TX);
    },
  };
  return {
    db,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

const OP: OperatorContext = Object.freeze({
  operatorId: '00000000-0000-0000-0000-0000000000aa',
  companyId: '00000000-0000-0000-0000-000000000001',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
  expiresAt: 9999999999,
}) as OperatorContext;

const CMD: CommandPayload = Object.freeze({
  commandId: '11111111-1111-7111-8111-111111111111',
  targetOperatorId: '22222222-2222-2222-8222-222222222222',
  aggregateType: 'road_run',
  aggregateId: '33333333-3333-4333-8333-333333333333',
  type: 'reassign',
  payload: { reason: 'driver_sick' },
  issuedAt: '2026-05-13T00:00:00.000Z',
}) as unknown as CommandPayload;

beforeEach(() => {
  mockAppendTriWrite.mockReset();
  mockAllocateServerSeq.mockReset();
  mockAllocateServerSeq.mockResolvedValue(42n);
  mockAppendTriWrite.mockResolvedValue({ duplicate: false });
});

describe('@fleet/api - CommandsService.persist (unit)', () => {
  it('opens a single transaction and returns appendTriWrite result', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    const result = await svc.persist(CMD, OP);
    expect(fake.transactionCalls).toBe(1);
    expect(result).toEqual({ duplicate: false });
  });

  it('propagates duplicate=true from appendTriWrite (replay path)', async () => {
    mockAppendTriWrite.mockResolvedValueOnce({ duplicate: true });
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    const result = await svc.persist(CMD, OP);
    expect(result).toEqual({ duplicate: true });
  });

  it('allocates serverSeq inside the transaction and passes it to appendTriWrite', async () => {
    mockAllocateServerSeq.mockResolvedValueOnce(123n);
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    expect(mockAllocateServerSeq).toHaveBeenCalledWith(FAKE_TX);
    expect(mockAppendTriWrite).toHaveBeenCalledTimes(1);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [tx, params] = call;
    expect(tx).toBe(FAKE_TX);
    expect(params.serverSeq).toBe(123n);
  });

  it('passes idempotent=true (kills BooleanLiteral mutant) — replay-safe per PDF', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [, params] = call;
    expect(params.idempotent).toBe(true);
  });

  it('routes actionId from commandId and aggregate fields verbatim', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [, params] = call;
    expect(params.actionId).toBe(CMD.commandId);
    expect(params.aggregateType).toBe(CMD.aggregateType);
    expect(params.aggregateId).toBe(CMD.aggregateId);
    expect(params.operatorId).toBe(OP.operatorId);
    expect(params.op).toBe(OP);
  });

  it('builds delta with type + payload + targetOperatorId (kills ObjectLiteral {} mutant)', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [, params] = call;
    expect(params.delta).toEqual({
      type: CMD.type,
      payload: CMD.payload,
      targetOperatorId: CMD.targetOperatorId,
    });
  });

  it('builds auditPayload with commandId + type + targetOperatorId (kills ObjectLiteral {} mutant)', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [, params] = call;
    expect(params.auditPayload).toEqual({
      commandId: CMD.commandId,
      type: CMD.type,
      targetOperatorId: CMD.targetOperatorId,
    });
  });

  it('builds outboxPayload with aggregateType + eventType + commandId (kills ObjectLiteral {} mutant)', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [, params] = call;
    expect(params.outboxPayload).toEqual({
      aggregateType: CMD.aggregateType,
      eventType: `${CMD.aggregateType}.command_issued`,
      commandId: CMD.commandId,
    });
  });

  it('uses commandIssuedEventType(aggregateType) for eventType (canonical "<aggregateType>.command_issued")', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [, params] = call;
    expect(params.eventType).toBe('road_run.command_issued');
  });

  it('routes to projections outbox queue (PDF: command events to projections)', async () => {
    const fake = makeDb();
    const svc = new CommandsService(fake.db as never);
    await svc.persist(CMD, OP);
    const call = mockAppendTriWrite.mock.calls[0];
    if (!call) throw new Error('expected appendTriWrite to be called');
    const [, params] = call;
    expect(params.queueName).toBe('projections');
  });
});
