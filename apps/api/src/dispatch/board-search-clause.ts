// apps/api/src/dispatch/board-search-clause.ts
// SSOT-bound Lenh dieu xe board free-text search WHERE clause, shared by the
// dispatch board AND the Excel export.
//
// Root cause this module closes: this logic was a PRIVATE method on
// DispatchController. The export service could not physically reach it, so the
// export shipped with no search support and Xuat Excel returned the whole board
// while a search was active. A private method is not a contract. Extracting it
// here means both readers call the SAME SQL, so board and export cannot drift.
//
// BOARD_SEARCH_CLAUSE_PREDICATES advertises which registry predicates this
// builder implements; the contract test asserts it equals the searchable arm of
// BOARD_SEARCH_COLUMNS in @fleet/sync-protocol. A column added to the registry
// without SQL here fails that suite instead of silently never matching.
//
// Vietnamese domain: unaccent() BOTH sides so a term typed without marks (chau)
// matches an accented value. Correlated EXISTS subqueries reach the joined and
// enriched columns (customer, warehouse, cargo_type) that are not in the base
// projection, so the match filters BEFORE LIMIT without changing cardinality.
// Every value is a BOUND parameter, never string-concatenated into SQL.
//
// Chenh lech is absent by design: it is JS-computed (computeWeightDiffKg), not a
// stored column, and the registry classifies it kind:derived with that reason.
import { or, sql } from 'drizzle-orm';
import type { BoardSearchPredicate } from '@fleet/sync-protocol';
import { dispatchBoardProjection } from '../database/schema/index.js';
/** Registry predicate ids this builder expresses as SQL. Pinned by the contract
 *  test against boardSearchableColumns() so the two can never diverge. */
export const BOARD_SEARCH_CLAUSE_PREDICATES: readonly BoardSearchPredicate[] = [
  'orderRefs',
  'customer',
  'cargoName',
  'driverName',
  'vehiclePlate',
  'plannedStartAt',
  'stopCount',
  'warehouseName',
];
/** Returns undefined when no term is given so callers keep their base predicate
 *  untouched. Takes companyId rather than OperatorContext so the export service
 *  and the board controller can both call it without sharing a request type. */
export function buildBoardSearchClause(
  companyId: string,
  search: string | undefined,
): ReturnType<typeof or> | undefined {
  if (search === undefined || search === '') return undefined;
  const like = '%' + search + '%';
  const co = companyId;
  const p = dispatchBoardProjection;
  return or(
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${p.transportOrderRefs}) AS ref WHERE unaccent(ref) ILIKE unaccent(${like}))`,
    sql`EXISTS (SELECT 1 FROM driver d WHERE d.operator_id = ${p.assignedOperatorId} AND d.company_id = ${co} AND unaccent(d.full_name) ILIKE unaccent(${like}))`,
    sql`EXISTS (SELECT 1 FROM vehicle v WHERE v.vehicle_id = ${p.assignedAssetId} AND v.company_id = ${co} AND unaccent(v.plate) ILIKE unaccent(${like}))`,
    sql`CAST(${p.plannedStartAt} AS text) ILIKE ${like}`,
    sql`CAST(${p.stopCount} AS text) ILIKE ${like}`,
    sql`EXISTS (SELECT 1 FROM road_run_transport_order rto JOIN transport_order t ON t.transport_order_id = rto.transport_order_id JOIN customer c ON c.customer_id = t.customer_id WHERE rto.road_run_id = ${p.roadRunId} AND rto.company_id = ${co} AND (unaccent(c.name) ILIKE unaccent(${like}) OR c.phone ILIKE ${like}))`,
    sql`EXISTS (SELECT 1 FROM road_run_transport_order rto JOIN stop st ON st.transport_order_id = rto.transport_order_id JOIN warehouse w ON w.warehouse_id = st.yard_id WHERE rto.road_run_id = ${p.roadRunId} AND rto.company_id = ${co} AND unaccent(w.name) ILIKE unaccent(${like}))`,
    sql`EXISTS (SELECT 1 FROM road_run_transport_order rto JOIN transport_order t ON t.transport_order_id = rto.transport_order_id JOIN cargo_type ct ON ct.cargo_type_id = t.cargo_type_id WHERE rto.road_run_id = ${p.roadRunId} AND rto.company_id = ${co} AND unaccent(ct.name) ILIKE unaccent(${like}))`,
  );
}
