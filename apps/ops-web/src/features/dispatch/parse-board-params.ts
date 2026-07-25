// apps/ops-web/src/features/dispatch/parse-board-params.ts
// Boundary parser for the Lệnh điều xe board URL state (?group=&page=&search=).
//
// Axis-1 (trust boundary): Next.js searchParams is UNTRUSTED input -- a
// hand-edited, bookmarked or crawler-mangled URL. It is parsed here, once, at
// the RSC entry, against the @fleet/sync-protocol SSOT RoadRunPageQuerySchema
// rather than hand-rolled if-chains in page.tsx.
//
// Axis-2 (SSOT): the accepted vocabulary and every default (group -> active,
// page -> 1, pageSize -> ROAD_RUN_PAGE_SIZE_DEFAULT) come from that one schema.
// Adding a 4th status group to the contract flows here with no edit.
//
// Lenient by construction: a garbage URL must render the DEFAULT board, never a
// 400 or a thrown RSC. So each field is parsed INDEPENDENTLY and falls back to
// its own schema default on failure -- a whole-object safeParse would let one
// bad param (?group=bogus) discard a good one (?page=3). Per-field parse keeps
// the good params. The API re-validates and re-caps server-side regardless
// (defence in depth); this parser is for rendering, not authorization.
// Type-only: z is referenced solely in parseField's signature (z.ZodType<T>),
// never at runtime -- the schema slices come from the SSOT contract's .shape.
import type { z } from 'zod';
import { RoadRunPageQuerySchema, type RoadRunPageQuery } from '@fleet/sync-protocol';
// Next.js 16 App Router shape: a repeated ?group=a&group=b arrives as an array.
export type BoardSearchParams = Record<string, string | string[] | undefined>;
const shape = RoadRunPageQuerySchema.shape;
// A repeated param takes its FIRST value (the leftmost wins), matching how the
// board's own generated hrefs are built (URLSearchParams.set, single-valued).
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
// Parse one field against its slice of the SSOT schema; on failure re-parse
// undefined so the schema's OWN default supplies the fallback (never a literal
// duplicated here). For an .optional() field that yields undefined.
function parseField<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : schema.parse(undefined);
}
export function parseBoardSearchParams(sp: BoardSearchParams): RoadRunPageQuery {
  const rawSearch = firstValue(sp['search']);
  // Trim BEFORE validating: a whitespace-only box must behave exactly like no
  // search (min(1) then rejects '' and the default undefined applies).
  const trimmed = rawSearch === undefined ? undefined : rawSearch.trim();
  const group = parseField(shape.group, firstValue(sp['group']));
  const page = parseField(shape.page, firstValue(sp['page']));
  const pageSize = parseField(shape.pageSize, firstValue(sp['pageSize']));
  const search = parseField(shape.search, trimmed);
  // exactOptionalPropertyTypes: omit the key entirely rather than assigning
  // undefined to an optional property.
  return {
    group,
    page,
    pageSize,
    ...(search === undefined ? {} : { search }),
  };
}
