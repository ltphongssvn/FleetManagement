// apps/ops-web/test/create-order-action-date-only.test.ts
// outside-in strict TDD RED (inner ring): the server action's Zod contract
// must enforce date-only ISO 8601 (YYYY-MM-DD) on plannedStartAt, pickupAt and
// deliveryAt, rejecting datetime-local strings ('YYYY-MM-DDTHH:mm'). The
// schema is the contract: type-driven, Zod-first.
//
// T8 follow-up (Next.js 15+ constraint): the schema lives in the sibling
// create-order.schema.ts module (not the 'use server' action) because the
// framework requires 'use server' modules to export only async functions.
// The schema import path moves; the contract is unchanged.
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { DateOnlyFormSchema } from '@/features/dispatch/create-order.schema';

describe('create-order action Zod contract (date-only)', () => {
  const base = {
    assignedOperatorId: '00000000-0000-0000-0000-000000000001',
    assignedAssetId:    '00000000-0000-0000-0000-000000000002',
    customer: '',
    cargo: '',
    vehiclePlate: '',
    driverName: '',
    pickupWarehouses: ['00000000-0000-0000-0000-000000000003'],
    deliveryWarehouses: ['00000000-0000-0000-0000-000000000004'],
  };

  it('accepts YYYY-MM-DD on plannedStartAt, pickupAt, deliveryAt', () => {
    const r = DateOnlyFormSchema.safeParse({
      ...base,
      plannedStartAt: '2026-05-30',
      pickupAt:       '2026-05-31',
      deliveryAt:     '2026-06-01',
    });
    expect(r.success).toBe(true);
  });

  it('rejects datetime-local strings on plannedStartAt', () => {
    const r = DateOnlyFormSchema.safeParse({
      ...base,
      plannedStartAt: '2026-05-30T07:12',
      pickupAt:       '2026-05-31',
      deliveryAt:     '2026-06-01',
    });
    expect(r.success).toBe(false);
  });

  it('rejects datetime-local strings on pickupAt', () => {
    const r = DateOnlyFormSchema.safeParse({
      ...base,
      plannedStartAt: '2026-05-30',
      pickupAt:       '2026-05-31T08:00',
      deliveryAt:     '2026-06-01',
    });
    expect(r.success).toBe(false);
  });

  it('rejects datetime-local strings on deliveryAt', () => {
    const r = DateOnlyFormSchema.safeParse({
      ...base,
      plannedStartAt: '2026-05-30',
      pickupAt:       '2026-05-31',
      deliveryAt:     '2026-06-01T17:30',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty strings', () => {
    const r = DateOnlyFormSchema.safeParse({
      ...base,
      plannedStartAt: '',
      pickupAt:       '2026-05-31',
      deliveryAt:     '2026-06-01',
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed dates (2026-13-01)', () => {
    const r = DateOnlyFormSchema.safeParse({
      ...base,
      plannedStartAt: '2026-13-01',
      pickupAt:       '2026-05-31',
      deliveryAt:     '2026-06-01',
    });
    expect(r.success).toBe(false);
  });

  it('infers TypeScript types for date fields as string', () => {
    type T = z.infer<typeof DateOnlyFormSchema>;
    const sample: T = {
      ...base,
      plannedStartAt: '2026-05-30',
      pickupAt:       '2026-05-31',
      deliveryAt:     '2026-06-01',
    } as T;
    expect(typeof sample.plannedStartAt).toBe('string');
    expect(typeof sample.pickupAt).toBe('string');
    expect(typeof sample.deliveryAt).toBe('string');
  });
});
