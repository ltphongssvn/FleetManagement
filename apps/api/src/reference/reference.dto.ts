// apps/api/src/reference/reference.dto.ts
import { z } from 'zod';

/** Strict write body for reference master-data CRUD (audit S1): the sole
 *  trust-boundary input of the 8 write routes. name carries customer name /
 *  cargo name / vehicle plate / warehouse name; role applies to warehouses
 *  only; phone applies to customers only. Unknown keys are rejected. */
export const ReferenceWriteSchema = z.strictObject({
  name: z.string().min(1).max(200),
  role: z.enum(['pickup', 'delivery']).optional(),
  phone: z.string().max(32).nullable().optional(),
});
export type ReferenceWriteDto = z.infer<typeof ReferenceWriteSchema>;

export interface ReferenceItem { readonly id: string; readonly label: string; readonly meta?: Record<string, string | null> }
export interface ReferenceListResponse { readonly items: readonly ReferenceItem[] }
