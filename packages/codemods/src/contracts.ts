// packages/codemods/src/contracts.ts
// Zod-first contracts for @fleet/codemods. Schemas are the single source of truth;
// TS types are inferred from them (type-driven). TransformOutcome is what a single
// AST transform reports back to the workspace orchestrator.
import { z } from 'zod';

export const TransformOutcomeSchema = z
  .object({
    changed: z.boolean(),
  })
  .strict();

export type TransformOutcome = z.infer<typeof TransformOutcomeSchema>;
