// packages/sync-protocol/src/board-search-contract.ts
// SSOT (provider-owned contract) for WHICH Lenh dieu xe board columns the
// dispatcher free-text search covers, and why an excluded column is excluded.
//
// 2026 contract-first, same rationale as transport-order-export-headers.ts:
// before this module the searchable set lived as prose in a
// dispatch.controller.ts comment plus hand-written or() arms, with hand-picked
// tests. Nothing bound the three, so the e2e could claim it proved ANY column
// while exercising two, and a join edit could silently kill Xe or Kho giao hàng
// with every gate still green. That is the SAME drift this package already
// fixed once for these exact labels (the Chenh lech export column reached the
// service and package tests but not the e2e spec). One importable definition
// makes it structurally impossible: the API derives its predicates from this
// registry and the tests iterate it, so a column added without a search
// decision fails the contract suite rather than shipping unsearchable.
//
// Labels are NOT re-typed here -- they are asserted against
// LENH_DIEU_XE_EXPORT_HEADERS (minus the kg-pair columns) by the contract test,
// so this cannot become a fourth copy of the dispatcher column set.
import { z } from 'zod';
import {
  EXPORT_KG_SUFFIX,
  EXPORT_PICKUP_LABEL_PREFIX,
  EXPORT_DELIVERY_LABEL_PREFIX,
  LENH_DIEU_XE_EXPORT_HEADERS,
} from './transport-order-export-headers.js';

/** Stable predicate identifiers the API maps to SQL. One per searchable column;
 *  the API owns HOW each is expressed, this contract owns THAT each exists. */
export const BOARD_SEARCH_PREDICATES = [
  'orderRefs',
  'customer',
  'driverName',
  'vehiclePlate',
  'plannedStartAt',
  'stopCount',
  'warehouseName',
] as const;
export type BoardSearchPredicate = (typeof BOARD_SEARCH_PREDICATES)[number];

/** One board column search decision. A discriminated union on searchable so the
 *  two states are exhaustive and a third is unrepresentable: searchable columns
 *  MUST name a predicate; excluded columns MUST state a reason. Zod rejects
 *  either half being omitted, so silence is not a valid encoding. */
export const BoardSearchColumnSchema = z.discriminatedUnion('searchable', [
  z.object({
    id: z.string().min(1),
    labels: z.array(z.string().min(1)).readonly(),
    searchable: z.literal(true),
    predicate: z.enum(BOARD_SEARCH_PREDICATES),
  }).strict(),
  z.object({
    id: z.string().min(1),
    labels: z.array(z.string().min(1)).readonly(),
    searchable: z.literal(false),
    reason: z.string().min(1),
  }).strict(),
]);
export type BoardSearchColumn = z.infer<typeof BoardSearchColumnSchema>;

/** Derived pickup/delivery label sets. The Vietnamese literal is NEVER
 *  re-typed here: the prefixes come from the export SSOT, so a label edit
 *  there flows here instead of silently unclaiming a column. */
const PICKUP_LABELS: readonly string[] = LENH_DIEU_XE_EXPORT_HEADERS.filter(
  (h) => h.startsWith(EXPORT_PICKUP_LABEL_PREFIX) && !h.endsWith(EXPORT_KG_SUFFIX),
);
const DELIVERY_LABELS: readonly string[] = LENH_DIEU_XE_EXPORT_HEADERS.filter(
  (h) => h.startsWith(EXPORT_DELIVERY_LABEL_PREFIX) && !h.endsWith(EXPORT_KG_SUFFIX),
);

/** The complete search registry. Every NAME column of the export SSOT is claimed
 *  exactly once (pinned by the contract test). */
export const BOARD_SEARCH_COLUMNS: readonly BoardSearchColumn[] = [
  { id: 'orderRefs', labels: ['Số lệnh'], searchable: true, predicate: 'orderRefs' },
  { id: 'customer', labels: ['Khách hàng'], searchable: true, predicate: 'customer' },
  { id: 'driverName', labels: ['Tài xế'], searchable: true, predicate: 'driverName' },
  { id: 'vehiclePlate', labels: ['Xe'], searchable: true, predicate: 'vehiclePlate' },
  { id: 'plannedStartAt', labels: ['Ngày dự kiến'], searchable: true, predicate: 'plannedStartAt' },
  { id: 'stopCount', labels: ['Số điểm'], searchable: true, predicate: 'stopCount' },
  {
    id: 'weightDiffKg',
    labels: ['Chênh lệch (Số giao - Số nhận)'],
    searchable: false,
    reason:
      'Derived, not stored: computeWeightDiffKg() is the SSOT and runs at read-time ' +
      'enrichment over stop proof weights. dispatch_board_projection observes the ' +
      'road_run aggregate only (applyDispatchBoardEvent returns unobserved_aggregate ' +
      'for anything else), so no manifest weight ever reaches a searchable column. ' +
      'Expressing it in SQL would fork the SSOT and let the board and the Excel ' +
      'export drift apart. Making it searchable is a projection change (observe the ' +
      'manifest aggregate, materialise weight_diff_kg through the same function, ' +
      'backfill via projection:rebuild), not a search change.',
  },
  { id: 'pickupWarehouses', labels: PICKUP_LABELS, searchable: true, predicate: 'warehouseName' },
  { id: 'deliveryWarehouses', labels: DELIVERY_LABELS, searchable: true, predicate: 'warehouseName' },
];

/** The dispatcher-visible NAME columns, derived from the export SSOT by dropping
 *  the paired kg-number columns. This is the set the registry must cover. */
export function boardSearchNameHeaders(): readonly string[] {
  return LENH_DIEU_XE_EXPORT_HEADERS.filter((h) => !h.endsWith(EXPORT_KG_SUFFIX));
}

/** Registry entries the API must express as SQL predicates. */
export function boardSearchableColumns(): readonly Extract<BoardSearchColumn, { searchable: true }>[] {
  return BOARD_SEARCH_COLUMNS.filter(
    (c): c is Extract<BoardSearchColumn, { searchable: true }> => c.searchable,
  );
}
