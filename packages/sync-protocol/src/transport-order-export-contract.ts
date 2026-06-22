// packages/sync-protocol/src/transport-order-export-contract.ts
// SSOT for the dispatcher-selectable Excel export day-range (Feature 4, 2026).
// The Lệnh điều xe manual export accepts an optional inclusive calendar-date
// range (VN timezone) to bound which road runs are exported by their planned
// start date. Dates are YYYY-MM-DD strings; YYYY-MM-DD sorts lexicographically
// the same as chronologically, so a plain string compare validates from <= to.
import { z } from 'zod';

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
