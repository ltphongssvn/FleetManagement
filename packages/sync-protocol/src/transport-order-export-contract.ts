// packages/sync-protocol/src/transport-order-export-contract.ts
// SSOT for the dispatcher-selectable Excel export day-range (Feature 4, 2026).
// The Lệnh điều xe manual export accepts an optional inclusive calendar-date
// range (VN timezone) to bound which road runs are exported by their planned
// start date. Dates are YYYY-MM-DD strings; YYYY-MM-DD sorts lexicographically
// the same as chronologically, so a plain string compare validates from <= to.
import { z } from 'zod';
import { roadRunStatusGroupSchema } from './dispatch-board-pagination-contract.js';

// A VN-local calendar date key, YYYY-MM-DD (e.g. 2026-05-24). Regex-validated so
// a malformed value is rejected at the boundary rather than silently mis-querying.
export const exportDayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD calendar date');
export type ExportDayKey = z.infer<typeof exportDayKeySchema>;

// Inclusive [from, to] range of VN-local calendar dates. .strict() rejects stray
// keys; .refine() enforces from <= to so an inverted range is a 400, not an empty
// export that looks like "no data".
export const ExportDateRangeSchema = z
  .object({
    from: exportDayKeySchema,
    to: exportDayKeySchema,
  })
  .strict()
  .refine((r) => r.from <= r.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });
export type ExportDateRange = z.infer<typeof ExportDateRangeSchema>;

// ---------------------------------------------------------------------------
// T67 (2026): the export QUERY contract -- the day range PLUS the dispatcher
// ACTIVE board search term and status tab.
//
// Root cause this closes: the manual export accepted only from/to, so pressing
// Xuat Excel while a search was active exported the WHOLE board, not the rows
// the dispatcher could see. 2026 export practice is what-you-see-is-what-you-
// export: an export returns the records matching the CURRENT search and
// filters, never a superset.
//
// ONE schema is shared by the ops-web server action (which BUILDS the query
// string) and the API controller (which VALIDATES it), so the two cannot drift
// -- the same contract-first cure transport-order-export-headers.ts applied to
// the column set. group reuses roadRunStatusGroupSchema: the board group
// vocabulary is never re-declared. search mirrors RoadRunPageQuerySchema.search
// (optional, min(1)) so the export term and the board term are the same thing.
//
// Every field is optional and an EMPTY query is valid and unfiltered. That is
// what preserves the login/logout daily-backup ledger invariant: those exports
// pass no query and must keep covering the full board.
export const ExportQuerySchema = z
  .object({
    from: exportDayKeySchema.optional(),
    to: exportDayKeySchema.optional(),
    search: z.string().min(1).optional(),
    group: roadRunStatusGroupSchema.optional(),
  })
  .strict()
  // Both-or-neither: a half-specified range is a caller bug. Rejecting it at the
  // boundary stops a silent full export masquerading as a bounded one.
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: 'from and to must be provided together',
    path: ['from'],
  })
  // YYYY-MM-DD sorts lexicographically the same as chronologically.
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });
export type ExportQuery = z.infer<typeof ExportQuerySchema>;
