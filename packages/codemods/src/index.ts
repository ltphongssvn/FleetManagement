// packages/codemods/src/index.ts
// Public API barrel for @fleet/codemods.
export {
  TransformOutcomeSchema,
  FileResultSchema,
  OrchestratorResultSchema,
  type TransformOutcome,
  type FileResult,
  type OrchestratorResult,
} from './contracts.js';
export { runCodemod, type Transform, type RunCodemodOptions } from './orchestrator.js';
export { transformParseOneNumber } from './transforms/parse-one-number.js';
export { parseCliArgs, CliOptionsSchema, type CliOptions } from './cli-options.js';
export {
  CODEMODS,
  TRANSFORM_NAMES,
  getCodemod,
  formatCodemodList,
  type Codemod,
  type PerFileCodemod,
  type TransformName,
} from './registry.js';
