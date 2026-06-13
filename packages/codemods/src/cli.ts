#!/usr/bin/env node
// packages/codemods/src/cli.ts
// fleet-codemods CLI entrypoint. --list prints the registered codemods. Otherwise parse +
// Zod-validate argv, build a ts-morph Project from the tsconfig, and dispatch by codemod
// kind: per-file -> runCodemod (OrchestratorResult), project -> runProjectCodemod
// (ProjectOutcome). runCodemodCli is exported and pure so it can be tested without argv;
// main() only runs when this file is executed directly, never on import.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';
import { parseCliArgs } from './cli-options.js';
import { runCodemod, runProjectCodemod } from './orchestrator.js';
import { getCodemod, formatCodemodList, type Codemod } from './registry.js';
import { type OrchestratorResult, type ProjectOutcome } from './contracts.js';

export function runCodemodCli(
  codemod: Codemod,
  project: Project,
  dryRun: boolean,
  includeGlobs: readonly string[] = [],
): OrchestratorResult | ProjectOutcome {
  if (codemod.kind === 'project') {
    if (includeGlobs.length > 0) {
      project.addSourceFilesAtPaths([...includeGlobs]);
    }
    return runProjectCodemod({ project, transform: codemod.transform, dryRun });
  }
  return runCodemod({ project, transform: codemod.transform, dryRun });
}

// Maps a (dry-run) codemod result to a drift verdict for --check. Project results carry
// `changes`; per-file results carry `changed`/`errored`. Any change, or any per-file
// error (we cannot prove clean if a file threw), counts as drift.
export function hasDrift(result: OrchestratorResult | ProjectOutcome): boolean {
  if ('changes' in result) {
    return result.changes.length > 0;
  }
  return result.changed > 0 || result.errored > 0;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    process.stdout.write(formatCodemodList() + '\n');
    return;
  }
  const options = parseCliArgs(argv);
  const codemod = getCodemod(options.transform);
  if (codemod === undefined) {
    throw new Error('No codemod registered for ' + options.transform);
  }
  const project = new Project({ tsConfigFilePath: options.tsConfigFilePath });
  const result = runCodemodCli(codemod, project, options.dryRun, options.include);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (options.check) {
    if (hasDrift(result)) {
      process.stderr.write('codemod ' + options.transform + ': drift detected (source is not migrated). Run the codemod and commit.\n');
      process.exitCode = 1;
    }
    return;
  }
  if ('errored' in result && result.errored > 0) {
    process.exitCode = 1;
  }
}

const argv1 = process.argv[1];
const isMain =
  argv1 !== undefined &&
  (() => {
    try {
      return realpathSync(argv1) === fileURLToPath(import.meta.url);
    } catch {
      return false;
    }
  })();

if (isMain) {
  main();
}
