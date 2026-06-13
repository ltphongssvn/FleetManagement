// packages/codemods/src/contracts.ts
// Zod-first contracts for @fleet/codemods. Schemas are the single source of truth; TS
// types are inferred from them. TransformOutcome is what one AST transform reports;
// FileResult / OrchestratorResult are what the workspace orchestrator returns per file
// and in aggregate.
import { z } from 'zod';

export const TransformOutcomeSchema = z
  .object({
    changed: z.boolean(),
  })
  .strict();

export type TransformOutcome = z.infer<typeof TransformOutcomeSchema>;

export const FileResultSchema = z
  .object({
    filePath: z.string(),
    changed: z.boolean(),
    error: z.string().optional(),
  })
  .strict();

export type FileResult = z.infer<typeof FileResultSchema>;

export const OrchestratorResultSchema = z
  .object({
    dryRun: z.boolean(),
    scanned: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
    results: z.array(FileResultSchema),
  })
  .strict();

export type OrchestratorResult = z.infer<typeof OrchestratorResultSchema>;
