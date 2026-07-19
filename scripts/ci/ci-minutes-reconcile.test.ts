// scripts/ci/ci-minutes-reconcile.test.ts
// RED: locks the billing-ground-truth contract before the module exists.
//
// Why this spec is adversarial about empty results: GitHub returns confident
// ZEROS from two separate endpoints in this domain. /actions/workflows/{id}/
// timing reports 0ms for every workflow while billing shows five figures, and
// the legacy /settings/billing/actions endpoint began returning all-zero usage
// when the enhanced billing platform rolled out. A third near-miss was our own:
// the docs document product as 'Actions' but the wire sends 'actions', so a
// case-sensitive filter matched 0 of 117 items and returned [] -- which reads
// exactly like 'no usage this month'. Absent data must THROW, never score 0.
import { describe, it, expect } from 'vitest';
import {
  BillingUsageSchema,
  linuxMinutesForRepo,
  reconcile,
} from './ci-minutes-reconcile.js';

const ITEM = {
  date: '2026-07-16',
  product: 'actions',
  sku: 'Actions Linux',
  quantity: 100,
  unitType: 'minutes',
  pricePerUnit: 0.006,
  grossAmount: 0.6,
  discountAmount: 0,
  netAmount: 0.6,
  repositoryName: 'FleetManagement',
};

describe('BillingUsageSchema', () => {
  it('parses the wire shape the enhanced billing platform actually sends', () => {
    const parsed = BillingUsageSchema.parse({ usageItems: [ITEM] });
    expect(parsed.usageItems).toHaveLength(1);
  });
  it('rejects a payload whose usageItems key is absent (not an empty month)', () => {
    expect(() => BillingUsageSchema.parse({})).toThrow();
  });
});

describe('linuxMinutesForRepo', () => {
  it('sums Actions Linux minutes for the named repo only', () => {
    const items = [
      ITEM,
      { ...ITEM, quantity: 416, repositoryName: 'llm-agents-from-scratch' },
      { ...ITEM, quantity: 9, sku: 'Actions storage' },
    ];
    expect(linuxMinutesForRepo(items, 'FleetManagement')).toBe(100);
  });
  it('THROWS when the product literal matches nothing -- the docs say Actions, the wire says actions', () => {
    const wrongCase = [{ ...ITEM, product: 'Actions' }];
    expect(() => linuxMinutesForRepo(wrongCase, 'FleetManagement')).toThrow(/no actions usage/i);
  });
  it('THROWS when the repo is absent from a non-empty payload rather than reporting 0', () => {
    expect(() => linuxMinutesForRepo([ITEM], 'NotARepo')).toThrow(/NotARepo/);
  });
});

describe('reconcile', () => {
  it('accepts a computed total within tolerance of billing truth', () => {
    expect(reconcile(11959, 11959, 0.05).ok).toBe(true);
    expect(reconcile(11500, 11959, 0.05).ok).toBe(true);
  });
  it('REJECTS a computed total outside tolerance -- the instrument is wrong, not the bill', () => {
    const r = reconcile(6000, 11959, 0.05);
    expect(r.ok).toBe(false);
    expect(r.driftPct).toBeGreaterThan(0.05);
  });
  it('refuses a zero billing total as a reconciliation base', () => {
    expect(() => reconcile(0, 0, 0.05)).toThrow(/zero/i);
  });
});
