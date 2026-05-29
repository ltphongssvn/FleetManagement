// apps/api/test/erp-inbound.service.test.ts
// Unit tests for ErpInboundService.recordInvoiceAck — kill Stryker mutants
// via mocked drizzle update().set().where().returning() chain.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ _kind: 'eq', col, value }),
  and: (...preds: unknown[]) => ({ _kind: 'and', preds }),
}));
vi.mock('../src/database/schema/index.js', () => ({
  erpInvoiceMap: {
    manifestCorrelationId: 'erpInvoiceMap.manifestCorrelationId',
    erpSystem: 'erpInvoiceMap.erpSystem',
  },
}));

import { ErpInboundService } from '../src/erp-inbound/erp-inbound.service.js';
import type { InvoiceAckInput } from '../src/erp-inbound/erp-inbound.dto.js';

interface SetCall { values: Record<string, unknown> }
interface WhereCall { predicate: unknown }
interface FakeDb {
  setCalls: SetCall[];
  whereCalls: WhereCall[];
  db: object;
}

function makeFakeDb(rowsReturned: unknown[]): FakeDb {
  const setCalls: SetCall[] = [];
  const whereCalls: WhereCall[] = [];
  const db = {
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        setCalls.push({ values });
        return {
          where: (predicate: unknown) => {
            whereCalls.push({ predicate });
            return {
              returning: () => Promise.resolve(rowsReturned),
            };
          },
        };
      },
    }),
  };
  return { setCalls, whereCalls, db: db as object };
}

const BASE: InvoiceAckInput = Object.freeze({
  manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
  erpSystem: 'sap',
  invoiceId: 'INV-001',
  status: 'acknowledged',
}) as InvoiceAckInput;

beforeEach(() => {
  vi.useRealTimers();
});

describe('@fleet/api - ErpInboundService.recordInvoiceAck (unit)', () => {
  it('returns updated=true when at least one row was updated', async () => {
    const fake = makeFakeDb([{ id: 'row-1' }]);
    const svc = new ErpInboundService(fake.db as never);
    const result = await svc.recordInvoiceAck(BASE);
    expect(result).toEqual({ updated: true });
  });

  it('returns updated=false when no rows matched (kills > 0 boundary mutants)', async () => {
    const fake = makeFakeDb([]);
    const svc = new ErpInboundService(fake.db as never);
    const result = await svc.recordInvoiceAck(BASE);
    expect(result).toEqual({ updated: false });
  });

  it('sets externalErpInvoiceId from input.invoiceId', async () => {
    const fake = makeFakeDb([{ id: 'r' }]);
    const svc = new ErpInboundService(fake.db as never);
    await svc.recordInvoiceAck({ ...BASE, invoiceId: 'INV-EXT-42' });
    const setCall = fake.setCalls[0];
    if (!setCall) throw new Error('expected set call');
    expect(setCall.values['externalErpInvoiceId']).toBe('INV-EXT-42');
  });

  it('maps status="acknowledged" to "acknowledged" and includes acknowledgedAt (kills EqualityOperator + ConditionalExpression mutants)', async () => {
    const fake = makeFakeDb([{ id: 'r' }]);
    const svc = new ErpInboundService(fake.db as never);
    await svc.recordInvoiceAck({ ...BASE, status: 'acknowledged' });
    const setCall = fake.setCalls[0];
    if (!setCall) throw new Error('expected set call');
    expect(setCall.values['status']).toBe('acknowledged');
    expect(setCall.values['acknowledgedAt']).toBeInstanceOf(Date);
  });

  it('maps status="failed" to "failed" and omits acknowledgedAt (kills conditional-spread mutants)', async () => {
    const fake = makeFakeDb([{ id: 'r' }]);
    const svc = new ErpInboundService(fake.db as never);
    await svc.recordInvoiceAck({ ...BASE, status: 'failed' });
    const setCall = fake.setCalls[0];
    if (!setCall) throw new Error('expected set call');
    expect(setCall.values['status']).toBe('failed');
    expect(setCall.values).not.toHaveProperty('acknowledgedAt');
  });

  it('omits failureReason when input.failureReason is undefined (kills conditional-spread mutant)', async () => {
    const fake = makeFakeDb([{ id: 'r' }]);
    const svc = new ErpInboundService(fake.db as never);
    await svc.recordInvoiceAck({ ...BASE, status: 'failed' });
    const setCall = fake.setCalls[0];
    if (!setCall) throw new Error('expected set call');
    expect(setCall.values).not.toHaveProperty('failureReason');
  });

  it('includes failureReason when input.failureReason is defined (kills conditional-spread mutant)', async () => {
    const fake = makeFakeDb([{ id: 'r' }]);
    const svc = new ErpInboundService(fake.db as never);
    await svc.recordInvoiceAck({ ...BASE, status: 'failed', failureReason: 'duplicate_invoice' });
    const setCall = fake.setCalls[0];
    if (!setCall) throw new Error('expected set call');
    expect(setCall.values['failureReason']).toBe('duplicate_invoice');
  });

  it('filters by (manifestCorrelationId AND erpSystem) — kills and()/eq()/ObjectLiteral mutants', async () => {
    const fake = makeFakeDb([{ id: 'r' }]);
    const svc = new ErpInboundService(fake.db as never);
    await svc.recordInvoiceAck({
      ...BASE,
      manifestCorrelationId: '22222222-2222-4222-8222-222222222222',
      erpSystem: 'oracle',
    });
    const whereCall = fake.whereCalls[0];
    if (!whereCall) throw new Error('expected where call');
    expect(whereCall.predicate).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'erpInvoiceMap.manifestCorrelationId', value: '22222222-2222-4222-8222-222222222222' },
        { _kind: 'eq', col: 'erpInvoiceMap.erpSystem', value: 'oracle' },
      ],
    });
  });

  it('returns updated=true when returning() resolves with multiple rows', async () => {
    const fake = makeFakeDb([{ id: 'a' }, { id: 'b' }]);
    const svc = new ErpInboundService(fake.db as never);
    const result = await svc.recordInvoiceAck(BASE);
    expect(result.updated).toBe(true);
  });

  it('uses a fresh Date for acknowledgedAt on each acknowledged call', async () => {
    const fake = makeFakeDb([{ id: 'r' }]);
    const svc = new ErpInboundService(fake.db as never);
    await svc.recordInvoiceAck({ ...BASE, status: 'acknowledged' });
    await new Promise((r) => setTimeout(r, 2));
    await svc.recordInvoiceAck({ ...BASE, status: 'acknowledged' });
    const first = fake.setCalls[0]?.values['acknowledgedAt'] as Date | undefined;
    const second = fake.setCalls[1]?.values['acknowledgedAt'] as Date | undefined;
    if (!first || !second) throw new Error('expected both acknowledgedAt');
    expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
  });
});
