// packages/sync-protocol/src/dispatch-board-pagination-contract.ts
// SSOT for the Lệnh điều xe board pagination + three-way status partition
// (2026 status-partitioned, pre-filtered-view pagination). ONE definition the
// API validates query params against and the ops-web loader parses the envelope
// from. Offset/page-number pagination is the deliberate choice: the dispatcher
// UI needs page-number jump + a jump-to-page search, which only offset supports
// (cursor is forward-only); the dataset is a single-company admin table, so the
// large-offset cost of OFFSET is irrelevant here.
//
// The partition mirrors @fleet/domain's road-run FSM terminal set, but is
// INLINED here (not imported) so this package stays dependency-free (zod only)
// — the SAME pattern dispatch-stop-view-contract.ts uses for ROAD_RUN_STATES
// (reused here from that sibling). active == the non-terminal states (planned,
// dispatched, started == 'pending + in-progress'); finished == completed;
// cancelled == cancelled. The FSM terminal set is unchanged (completed AND
// cancelled are both terminal) — the board simply PRESENTS the two terminal
// outcomes as separate dispatcher tabs (T16). Membership is pinned by the
// contract test so it can never drift from the domain.
//
// This module is the ONE definition of the group vocabulary for every consumer:
// the API validates query params against RoadRunPageQuerySchema, and ops-web
// parses the URL through the same schema (parse-board-params.ts) and types its
// board components with RoadRunStatusGroup. No consumer re-declares the union.
import { z } from 'zod';
import { ROAD_RUN_STATES, type RoadRunStateName } from './dispatch-stop-view-contract.js';
import {
  DispatchBoardApiRowSchema,
  DispatchBoardRowSchema,
} from './dispatch-stop-view-contract.js';

// The three dispatcher-facing slices of the board, each rendered as its own tab:
// 'active' is the default view (Đang chạy — pending + in-progress); 'finished'
// is the delivered view (Đã hoàn tất — completed only); 'cancelled' is the
// cancelled view (Lệnh Hủy). Both terminal outcomes are surfaced separately so a
// dispatcher can tell a delivered run from a cancelled one at a glance.
export const ROAD_RUN_STATUS_GROUPS = ['active', 'finished', 'cancelled'] as const;
export const roadRunStatusGroupSchema = z.enum(ROAD_RUN_STATUS_GROUPS);
export type RoadRunStatusGroup = z.infer<typeof roadRunStatusGroupSchema>;

// Terminal (finished) road-run states. Mirrors @fleet/domain roadRunFsm terminal
// set; inlined to keep this package zod-only. Pinned by the contract test so it
// stays in lockstep with the domain.
const ROAD_RUN_TERMINAL_STATES: readonly RoadRunStateName[] = ['completed', 'cancelled'];

// Partition the canonical state list into the two groups by terminal membership,
// from the single inlined state list so the partition is exhaustive + disjoint
// by construction (every state lands in exactly one group). Frozen so callers
// cannot mutate the shared arrays.
// T16 board split: cancelled is surfaced as its OWN dispatcher tab (Lenh Huy),
// so it leaves the finished group. finished now holds only 'completed'; both
// remain terminal (the FSM terminal set is unchanged), but the board presents
// them separately so dispatchers can distinguish delivered from cancelled runs.
const CANCELLED_STATES: readonly RoadRunStateName[] = Object.freeze(['cancelled']);
const FINISHED_STATES: readonly RoadRunStateName[] = Object.freeze(
  ROAD_RUN_STATES.filter(
    (s) => ROAD_RUN_TERMINAL_STATES.includes(s) && !CANCELLED_STATES.includes(s),
  ),
);
const ACTIVE_STATES: readonly RoadRunStateName[] = Object.freeze(
  ROAD_RUN_STATES.filter((s) => !ROAD_RUN_TERMINAL_STATES.includes(s)),
);

export function statesForStatusGroup(group: RoadRunStatusGroup): readonly RoadRunStateName[] {
  if (group === 'finished') return FINISHED_STATES;
  if (group === 'cancelled') return CANCELLED_STATES;
  return ACTIVE_STATES;
}

// Server-side cap on page size: a hard upper bound so a client can never request
// an unbounded page (2026 pagination best practice — always cap server-side).
export const ROAD_RUN_PAGE_SIZE_MAX = 100;
export const ROAD_RUN_PAGE_SIZE_DEFAULT = 20;

// Query contract for GET /dispatch/board (paginated). page/pageSize use z.coerce
// because query-string values arrive as strings; group defaults to the active
// view; search is an optional free-text term (order ref / customer). .strict()
// rejects stray keys so a typo'd param is a 400, not a silent no-op.
export const RoadRunPageQuerySchema = z
  .object({
    group: roadRunStatusGroupSchema.default('active'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(ROAD_RUN_PAGE_SIZE_MAX)
      .default(ROAD_RUN_PAGE_SIZE_DEFAULT),
    search: z.string().min(1).optional(),
  })
  .strict();
export type RoadRunPageQuery = z.infer<typeof RoadRunPageQuerySchema>;

// Inferred shape of any paginated envelope (data + page metadata + total count
// + hasMore). Generic over the ROW type so each endpoint's row type flows
// through makePaginatedResponseSchema's return annotation. Used as the factory's
// explicit return type (z.ZodType<PaginatedResponse<...>>) because Zod v4 mangles
// a precise z.ZodObject<{...}> generic return to any (colinhacks/zod#4546); the
// structural z.ZodType supertype keeps .parse() returning the correct shape.
export interface PaginatedResponse<TRow> {
  readonly data: readonly TRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasMore: boolean;
}

// Generic offset-pagination response envelope. A factory so every paginated
// endpoint shares ONE shape (data + page metadata + total count + hasMore);
// never paginate without a total (2026 UX rule). Bare arrays are avoided so the
// envelope can grow backward-compatibly. .strict() catches server drift.
// Constraint is z.ZodType (the v4 form; the old generic alias is deprecated). Return type is
// annotated explicitly (lint: explicit-function-return-type) as the structural
// PaginatedResponse supertype so the inferred row type survives (see #4546).
export function makePaginatedResponseSchema<T extends z.ZodType>(
  itemSchema: T,
): z.ZodType<PaginatedResponse<z.infer<T>>> {
  return z
    .object({
      data: z.array(itemSchema).readonly(),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      total: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative(),
      hasMore: z.boolean(),
    })
    .strict() as unknown as z.ZodType<PaginatedResponse<z.infer<T>>>;
}

// ---------------------------------------------------------------------------
// Concrete paginated board envelopes (2026): the page-response shapes the API
// PRODUCES and ops-web PARSES, built from the generic offset factory over the
// canonical board-row schemas. Mirrors the non-paginated pair
// (DispatchBoardApiResponseSchema produced / DispatchBoardResponseSchema parsed)
// in dispatch-stop-view-contract.ts: the API emits the richer api-row (stops
// carry stopId), ops-web parses the leaner row (Postel). data items are the SAME
// canonical rows, so every existing row-field rule is reused unchanged.
// ---------------------------------------------------------------------------

// API-PRODUCED page (rows are DispatchBoardApiRow — stops carry stopId).
export const DispatchBoardPageApiResponseSchema =
  makePaginatedResponseSchema(DispatchBoardApiRowSchema);
export type DispatchBoardPageApiResponse = z.infer<typeof DispatchBoardPageApiResponseSchema>;

// CLIENT-PARSED page (rows are the leaner DispatchBoardRow ops-web renders).
export const DispatchBoardPageResponseSchema = makePaginatedResponseSchema(DispatchBoardRowSchema);
export type DispatchBoardPageResponse = z.infer<typeof DispatchBoardPageResponseSchema>;
