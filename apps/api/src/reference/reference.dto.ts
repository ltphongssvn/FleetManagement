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

// Reference list wire shapes now DERIVE from the @fleet/sync-protocol SSOT
// (reference-contract.ts) instead of a hand-written local twin -- one of the
// four duplicated definitions consolidated by the schema-first arc. Re-export
// keeps the api-local names stable for the controller/service signatures.
export type {
  ReferenceItem,
  ReferenceListResponse,
} from '@fleet/sync-protocol';
