// scripts/ci/ci-minutes-reconcile.ts
// Billing ground truth: what the account was ACTUALLY charged, per repo, from
// the enhanced billing platform (/settings/billing/usage). This is the
// denominator every CI cut is measured against -- ci-minutes-audit.ts
// attributes minutes to workflows; this module says whether that attribution
// adds up to the real bill. If it does not, the instrument is wrong and every
// cut sized against it is guesswork.
//
// Three confident-zero hazards in this one domain, all OBSERVED, not theorized:
//   1. /actions/workflows/{id}/timing returns 0ms for every workflow while
//      billing shows five figures. It is closing down.
//   2. The legacy /settings/billing/actions endpoint began returning all-zero
//      usage when the enhanced billing platform rolled out.
//   3. GitHub docs document product as "Actions"; the wire sends "actions". A
//      case-sensitive filter matched 0 of 117 real items and returned [] --
//      indistinguishable from a month with no CI at all.
// Hence: a filter matching NOTHING throws. Absent data is never a zero.
//
// Pure exports only -- no I/O, mirroring resolve-ci-sha.ts:22.
import { z } from 'zod';

// One line of the enhanced-billing usage report. Field names and casing come
// from the observed wire, not the docs (hazard 3).
export const UsageItemSchema = z.object({
  date: z.string(),
  product: z.string(),
  sku: z.string(),
  quantity: z.number(),
  unitType: z.string(),
  pricePerUnit: z.number(),
  grossAmount: z.number(),
  discountAmount: z.number(),
  netAmount: z.number(),
  repositoryName: z.string(),
});
export type UsageItem = z.infer<typeof UsageItemSchema>;

// usageItems is REQUIRED: an absent key is a malformed payload, not a quiet
// month, and must not parse into an empty-and-therefore-free report.
export const BillingUsageSchema = z.object({
  usageItems: z.array(UsageItemSchema),
});
export type BillingUsage = z.infer<typeof BillingUsageSchema>;

const ACTIONS_PRODUCT = 'actions';
const LINUX_SKU = 'Actions Linux';

// Billed Linux minutes for ONE repo. Throws rather than returning 0 when the
// product literal matches nothing (drifted casing or a renamed product would
// otherwise read as "no usage"), or when the repo is absent from a payload that
// demonstrably contains Actions usage.
export function linuxMinutesForRepo(items: readonly UsageItem[], repo: string): number {
  const actions = items.filter((i) => i.product === ACTIONS_PRODUCT);
  if (actions.length === 0) {
    const seen = Array.from(new Set(items.map((i) => i.product))).join(', ');
    throw new Error(
      'no actions usage matched product=' + ACTIONS_PRODUCT +
      ' -- products present: [' + seen + ']. Refusing to report 0.',
    );
  }
  const linux = actions.filter((i) => i.sku === LINUX_SKU);
  const mine = linux.filter((i) => i.repositoryName === repo);
  if (mine.length === 0) {
    const seen = Array.from(new Set(linux.map((i) => i.repositoryName))).join(', ');
    throw new Error(
      'repo ' + repo + ' has no ' + LINUX_SKU + ' usage -- repos present: [' +
      seen + ']. Refusing to report 0.',
    );
  }
  return mine.reduce((sum, i) => sum + i.quantity, 0);
}

export interface Reconciliation {
  readonly ok: boolean;
  readonly computedMinutes: number;
  readonly billedMinutes: number;
  readonly driftPct: number;
}

// Compare the aggregator per-workflow total against billing truth. A zero
// billing base is refused: dividing by it would report perfect agreement (or
// NaN) exactly when the data is most suspect.
export function reconcile(
  computedMinutes: number,
  billedMinutes: number,
  tolerance: number,
): Reconciliation {
  if (billedMinutes === 0) {
    throw new Error('billed minutes is zero -- refusing to reconcile against a zero base');
  }
  const driftPct = Math.abs(computedMinutes - billedMinutes) / billedMinutes;
  return { ok: driftPct <= tolerance, computedMinutes, billedMinutes, driftPct };
}
