// packages/codemods/src/orchestrator.ts
// Orchestrators for @fleet/codemods.
// runCodemod: per-file transforms across a ts-morph Project with per-file error isolation
//   (one failing file never aborts the run), honoring dryRun and saving changed files;
//   generated artifacts (.d.ts, node_modules, dist/) are skipped.
// runProjectCodemod: project-level transforms (multi-file refactors such as extractions).
//   The transform mutates the project and returns the changes it made; saving is deferred
//   to a single project.saveSync() (skipped in dryRun) so an error mid-transform never
//   leaves the file system in a halfway state.
import { type Project, type SourceFile } from 'ts-morph';
import {
  OrchestratorResultSchema,
  ProjectOutcomeSchema,
  type FileResult,
  type OrchestratorResult,
  type ProjectChange,
  type ProjectOutcome,
  type TransformOutcome,
} from './contracts.js';

export type Transform = (sourceFile: SourceFile) => TransformOutcome;
export type ProjectTransform = (project: Project) => readonly ProjectChange[];

export interface RunCodemodOptions {
  readonly project: Project;
  readonly transform: Transform;
  readonly dryRun?: boolean;
}

export interface RunProjectCodemodOptions {
  readonly project: Project;
  readonly transform: ProjectTransform;
  readonly dryRun?: boolean;
}

function isGenerated(sourceFile: SourceFile, filePath: string): boolean {
  return (
    sourceFile.isDeclarationFile() || sourceFile.isInNodeModules() || filePath.includes('/dist/')
  );
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
  return OrchestratorResultSchema.parse({
    dryRun,
    scanned: results.length,
    changed,
    errored,
    results,
  });
}

export function runProjectCodemod(options: RunProjectCodemodOptions): ProjectOutcome {
  const dryRun = options.dryRun === true;
  const changes = options.transform(options.project);
  if (!dryRun) {
    options.project.saveSync();
  }
  return ProjectOutcomeSchema.parse({ dryRun, changes: [...changes] });
}
