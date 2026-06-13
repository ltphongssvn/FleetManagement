// packages/codemods/src/orchestrator.ts
// Workspace orchestrator: apply a transform across every SOURCE file in a ts-morph
// Project with per-file error isolation (one failing file never aborts the run),
// honoring dryRun (no writes) and saving changed files to disk otherwise. Saving only
// after a successful, changed transform avoids leaving the file system in a halfway
// state. Generated artifacts are never transformed: declaration files (.d.ts), anything
// under a dist/ output directory, and node_modules are skipped. Returns a Zod-validated
// summary (OrchestratorResult).
import { type Project, type SourceFile } from 'ts-morph';
import {
  OrchestratorResultSchema,
  type FileResult,
  type OrchestratorResult,
  type TransformOutcome,
} from './contracts.js';

export type Transform = (sourceFile: SourceFile) => TransformOutcome;

export interface RunCodemodOptions {
  readonly project: Project;
  readonly transform: Transform;
  readonly dryRun?: boolean;
}

function isGenerated(sourceFile: SourceFile, filePath: string): boolean {
  return sourceFile.isDeclarationFile() || sourceFile.isInNodeModules() || filePath.includes('/dist/');
}

export function runCodemod(options: RunCodemodOptions): OrchestratorResult {
  const dryRun = options.dryRun === true;
  const results: FileResult[] = [];
  let changed = 0;
  let errored = 0;
  for (const sourceFile of options.project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (isGenerated(sourceFile, filePath)) {
      continue;
    }
    try {
      const outcome = options.transform(sourceFile);
      if (outcome.changed) {
        changed += 1;
        if (!dryRun) sourceFile.saveSync();
        results.push({ filePath, changed: true });
      } else {
        results.push({ filePath, changed: false });
      }
    } catch (e) {
      errored += 1;
      const message = e instanceof Error ? e.message : 'non-Error thrown: ' + JSON.stringify(e);
      results.push({ filePath, changed: false, error: message });
    }
  }
  return OrchestratorResultSchema.parse({ dryRun, scanned: results.length, changed, errored, results });
}
