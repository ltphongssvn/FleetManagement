// apps/api/src/common/uuid-param.schema.ts
// Shared Zod SSOT for :id route params (follow-up #3, 2026-07-07).
// Prod evidence: DELETE /admin/drivers/NONE leaked pg 22P02
// (string_to_uuid) as HTTP 500. Every :id handler parses through this
// schema at the controller boundary; the global ZodExceptionFilter maps
// the throw to 400 BEFORE any service or SQL runs.
import { z } from 'zod';
export const UuidParamSchema = z.uuid();
export type UuidParam = z.infer<typeof UuidParamSchema>;
