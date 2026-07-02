// packages/sync-protocol/src/driver-orders-pagination-contract.ts
// SSOT for the driver-app 'Xem Lệnh Điều Xe' completed-trips pagination
// (2026 status-partitioned, pre-filtered-view pagination — driver mobile
// counterpart of dispatch-board-pagination-contract.ts). ONE definition the
// API validates query params against and the driver client parses the
// envelope from.
//
// Design decisions pinned by the contract test:
// - NO 'group' param. The dispatcher board is one endpoint serving two views
//   behind a group toggle; the driver surface is the opposite — the active
//   list (GET /transport-orders/assigned) and the completed page are separate
//   endpoints, so this query IS the finished partition. .strict() makes a
//   stray group key a 400, not a silent no-op.
// - page/pageSize reuse the board's shared caps (ROAD_RUN_PAGE_SIZE_MAX /
//   ROAD_RUN_PAGE_SIZE_DEFAULT): one server-side cap policy product-wide.
// - The response envelope is makePaginatedResponseSchema over the canonical
//   ListAssignedRowSchema — the SAME row the assigned endpoint serves, so the
//   assignments screen and the completed screen render one row shape and any
//   row-field rule is defined exactly once.
// - Offset (page-number) pagination, deliberately matching the board: the
//   completed page is a driver-scoped, single-company archive; mobile renders
//   it as infinite scroll (hasMore drives useInfiniteQuery.getNextPageParam),
//   and offset keeps the wire contract identical to ops-web so the API layer
//   shares one pagination implementation.
import { z } from 'zod';
import {
  ROAD_RUN_PAGE_SIZE_MAX,
  ROAD_RUN_PAGE_SIZE_DEFAULT,
  makePaginatedResponseSchema,
} from './dispatch-board-pagination-contract.js';
import { ListAssignedRowSchema } from './list-assigned-contract.js';

// Query contract for the driver completed-trips page. page/pageSize use
// z.coerce because query-string values arrive as strings; search is an
// optional free-text term (order ref / customer name). .strict() rejects
// stray keys — including 'group', by design (see header).
export const DriverCompletedPageQuerySchema = z
  .object({
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
export type DriverCompletedPageQuery = z.infer<typeof DriverCompletedPageQuerySchema>;

// Response envelope: a standard offset page of canonical driver rows. The API
// PRODUCES this shape; the driver-app client PARSES it at the trust boundary.
export const DriverCompletedPageResponseSchema = makePaginatedResponseSchema(ListAssignedRowSchema);
export type DriverCompletedPageResponse = z.infer<typeof DriverCompletedPageResponseSchema>;
